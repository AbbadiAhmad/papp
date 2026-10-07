import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { StudentsService } from './students.service';

const READER_ROLE_CODE = 'reader';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'code' | 'name' | 'email' | 'className' | 'externalId' | 'department' | 'isActive';

/** Header text (lower-cased, trimmed) -> field. English only; the export writes exactly these. */
const HEADER_ALIASES: Record<string, Field> = {
  code: 'code',
  'reader code': 'code',
  name: 'name',
  email: 'email',
  class: 'className',
  'class name': 'className',
  id: 'externalId',
  'external id': 'externalId',
  externalid: 'externalId',
  department: 'department',
  active: 'isActive',
};

export interface ParsedStudentRow {
  row: number;
  code: string | null;
  name: string | null;
  email: string | null;
  className: string | null;
  externalId: string | null;
  department: string | null;
  /** null = column blank (unchanged on update, active on create). */
  isActive: boolean | null;
  /** Set when the Active cell held something that isn't yes/no — reported as the row's error. */
  isActiveInvalid?: boolean;
}

export interface StudentImportRowResult extends ParsedStudentRow {
  valid: boolean;
  error: string | null;
  action: 'create' | 'update' | null;
  matchedStudentId: string | null;
}

export interface StudentImportReport {
  rows: StudentImportRowResult[];
  validCount: number;
  invalidCount: number;
  allValid: boolean;
}

/**
 * Excel import/export of readers (mirrors core's D30/D42 users import:
 * preview writes nothing; commit re-parses the uploaded file, re-validates
 * from scratch and applies everything in ONE transaction, all-or-nothing).
 *
 * Upsert key: `code` when given, else `email`. New readers get an
 * auto-generated code when the Code cell is blank, and a random temporary
 * password that is NOT returned anywhere (it would otherwise land in the
 * audit trail) — the librarian issues a usable one afterwards with
 * "Reset password" in the reader's Edit dialog. Blank cells on an existing
 * reader leave the stored value unchanged.
 */
@Injectable()
export class StudentsExcelService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  constructor(private readonly students: StudentsService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // --- export ---------------------------------------------------------------

  async exportWorkbook(): Promise<Buffer> {
    const rows = await this.students.list();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Readers');
    sheet.columns = [
      { header: 'Code', key: 'code', width: 16 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Class', key: 'className', width: 16 },
      { header: 'External ID', key: 'externalId', width: 18 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Active', key: 'isActive', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const r of rows) {
      sheet.addRow({
        code: r.code,
        name: r.name ?? '',
        email: r.email ?? '',
        className: r.className ?? '',
        externalId: r.externalId ?? '',
        department: r.department ?? '',
        isActive: r.isActive ? 'yes' : 'no',
      });
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // --- import ---------------------------------------------------------------

  async parseWorkbook(buffer: Buffer): Promise<ParsedStudentRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw new BadRequestException('Could not read the uploaded file as a valid .xlsx workbook');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('The workbook has no worksheets');

    const columns = new Map<number, Field>();
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      const field = HEADER_ALIASES[cellText(cell.value).toLowerCase()];
      if (field) columns.set(col, field);
    });
    if (!columns.size) {
      throw new BadRequestException('No recognized columns found in the header row (expected: Code, Name, Email, Class, External ID, Department, Active)');
    }

    const rows: ParsedStudentRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const parsed: ParsedStudentRow = {
        row: rowNumber, code: null, name: null, email: null, className: null, externalId: null, department: null, isActive: null,
      };
      let any = false;
      for (const [col, field] of columns) {
        const text = cellText(row.getCell(col).value);
        if (!text) continue;
        any = true;
        if (field === 'isActive') {
          const flag = parseFlag(text);
          if (flag === undefined) parsed.isActiveInvalid = true;
          else parsed.isActive = flag;
        } else {
          parsed[field] = text;
        }
      }
      if (any) rows.push(parsed);
    }
    return rows;
  }

  /** Read-only validation (no writes) — also used by commit as its own first step. */
  async validateRows(rows: ParsedStudentRow[]): Promise<StudentImportReport> {
    await this.students.syncReaderProfiles(); // self-registered readers must be matchable too

    const codes = rows.map((r) => r.code).filter((v): v is string => !!v);
    const emails = rows.map((r) => r.email?.toLowerCase()).filter((v): v is string => !!v);
    const [byCode, users] = await Promise.all([
      codes.length ? this.prisma.libraryStudent.findMany({ where: { code: { in: codes } } }) : [],
      emails.length ? this.prisma.user.findMany({ where: { email: { in: emails, mode: 'insensitive' } }, select: { id: true, email: true } }) : [],
    ]);
    const studentByCode = new Map(byCode.map((s) => [s.code, s]));
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    const profiles = users.length ? await this.prisma.libraryStudent.findMany({ where: { userId: { in: users.map((u) => u.id) } } }) : [];
    const studentByUserId = new Map(profiles.map((s) => [s.userId, s]));
    // Codes held by readers OTHER than the one a row targets must be rejected too.
    const seenCodes = new Map<string, number>();
    const seenEmails = new Map<string, number>();

    const results = rows.map((row): StudentImportRowResult => {
      const fail = (error: string): StudentImportRowResult => ({ ...row, valid: false, error, action: null, matchedStudentId: null });

      if (row.isActiveInvalid) return fail('Active must be yes/no');
      if (row.email && !EMAIL_RE.test(row.email)) return fail(`Invalid email "${row.email}"`);
      if (!row.code && !row.email) return fail('Each row needs a Code or an Email');

      if (row.code) {
        const first = seenCodes.get(row.code);
        if (first) return fail(`Duplicate code "${row.code}" (also on row ${first})`);
        seenCodes.set(row.code, row.row);
      }
      if (row.email) {
        const key = row.email.toLowerCase();
        const first = seenEmails.get(key);
        if (first) return fail(`Duplicate email "${row.email}" (also on row ${first})`);
        seenEmails.set(key, row.row);
      }

      const codeMatch = row.code ? studentByCode.get(row.code) : undefined;
      const emailUser = row.email ? userByEmail.get(row.email.toLowerCase()) : undefined;
      const emailMatch = emailUser ? studentByUserId.get(emailUser.id) : undefined;

      if (emailUser && !emailMatch) return fail(`"${row.email}" belongs to an account that is not a reader — manage it from Users`);
      if (codeMatch && emailMatch && codeMatch.id !== emailMatch.id) {
        return fail(`Code "${row.code}" and email "${row.email}" belong to two different readers`);
      }
      const matched = codeMatch ?? emailMatch;
      if (matched) return { ...row, valid: true, error: null, action: 'update', matchedStudentId: matched.id };

      // Creating: a lookup by code alone that found nothing is a new reader, which needs name + email.
      if (!row.name) return fail('Name is required for a new reader');
      if (!row.email) return fail('Email is required for a new reader');
      return { ...row, valid: true, error: null, action: 'create', matchedStudentId: null };
    });

    const validCount = results.filter((r) => r.valid).length;
    return { rows: results, validCount, invalidCount: results.length - validCount, allValid: results.length > 0 && validCount === results.length };
  }

  /** Re-parses and re-validates the uploaded file, then applies it all-or-nothing. A report with `allValid: false` means nothing was written. */
  async commit(buffer: Buffer, importedBy: string): Promise<StudentImportReport> {
    const report = await this.validateRows(await this.parseWorkbook(buffer));
    if (!report.allValid) return report;

    const readerRole = await this.prisma.role.findUnique({ where: { code: READER_ROLE_CODE } });
    if (!readerRole) throw new BadRequestException(`The "${READER_ROLE_CODE}" role does not exist — cannot create reader accounts`);

    // Hash outside the transaction — argon2 is deliberately slow.
    const creates = report.rows.filter((r) => r.action === 'create');
    const hashes = await Promise.all(creates.map(() => argon2.hash(randomBytes(18).toString('base64url'), { type: argon2.argon2id })));

    try {
      await this.prisma.$transaction(
        async (tx) => {
          let createIndex = 0;
          for (const row of report.rows) {
            if (row.action === 'update') {
              const student = await tx.libraryStudent.findUniqueOrThrow({ where: { id: row.matchedStudentId! } });
              const userData: Prisma.UserUpdateInput = {
                name: row.name ?? undefined,
                email: row.email ?? undefined,
                externalId: row.externalId ?? undefined,
                department: row.department ?? undefined,
                isActive: row.isActive ?? undefined,
              };
              if (Object.values(userData).some((v) => v !== undefined)) {
                await tx.user.update({ where: { id: student.userId }, data: userData });
              }
              if (row.code) await this.students.reconcileCodeSequence(tx, row.code);
              await tx.libraryStudent.update({ where: { id: student.id }, data: { code: row.code ?? undefined, className: row.className ?? undefined } });
            } else {
              const code = row.code ?? (await this.students.allocateCode(tx));
              if (row.code) await this.students.reconcileCodeSequence(tx, row.code);
              const user = await tx.user.create({
                data: {
                  email: row.email!,
                  name: row.name!,
                  externalId: row.externalId ?? undefined,
                  department: row.department ?? undefined,
                  isActive: row.isActive ?? true,
                  passwordHash: hashes[createIndex++],
                  mustChangePassword: true,
                  createdBy: importedBy,
                },
              });
              await tx.userRole.create({ data: { userId: user.id, roleId: readerRole.id, assignedBy: importedBy } });
              await tx.libraryStudent.create({ data: { userId: user.id, code, className: row.className ?? undefined } });
            }
          }
        },
        { timeout: 120_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        throw new ConflictException(`Import rejected — a reader or user with this ${target} already exists (nothing was imported)`);
      }
      throw error;
    }
    return report;
  }
}

/** ExcelJS cell values may be rich objects (hyperlink emails, formulas, rich text) — flatten to trimmed text. */
function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && value.text !== undefined) return cellText(value.text as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((p) => p.text).join('').trim();
    if ('result' in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return '';
  }
  return String(value).trim();
}

function parseFlag(text: string): boolean | undefined {
  const v = text.toLowerCase();
  if (['yes', 'y', 'true', '1', 'active', 'نعم'].includes(v)) return true;
  if (['no', 'n', 'false', '0', 'inactive', 'لا'].includes(v)) return false;
  return undefined;
}
