import { BadRequestException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { buildXlsx, cellToText, readFirstSheet } from '../../common/excel/xlsx-io';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeDateOfBirth, toDateOnly } from './date-of-birth.util';
import { ExportRow, ImportReport, ImportRowResult, ParsedImportRow } from './excel-import.types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Recognized header names (case-insensitive, whitespace-insensitive) -> our field names. */
const HEADER_ALIASES: Record<string, keyof Omit<ParsedImportRow, 'row'>> = {
  name: 'name',
  email: 'email',
  id: 'externalId',
  externalid: 'externalId',
  'external id': 'externalId',
  role: 'roleCode',
  department: 'department',
  'date of birth': 'dateOfBirth',
  dateofbirth: 'dateOfBirth',
  dob: 'dateOfBirth',
  birthdate: 'dateOfBirth',
  'birth date': 'dateOfBirth',
};

/**
 * D30 (Excel user import: name/email/ID/role/department, upsert by
 * ID-then-email with conflict rejection) + D42 (preview step, added Phase 2:
 * preview validates without writing, commit re-validates from scratch and
 * commits all-or-nothing in a single transaction).
 *
 * Kept deliberately simple per D42 — not a generalized import framework.
 */
@Injectable()
export class ExcelImportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parses an uploaded .xlsx buffer into raw rows — no validation, no DB access. */
  async parseWorkbook(buffer: Buffer): Promise<ParsedImportRow[]> {
    let sheet;
    try {
      sheet = await readFirstSheet(buffer);
    } catch {
      throw new BadRequestException('Could not read the uploaded file as a valid .xlsx workbook');
    }
    if (!sheet) {
      throw new BadRequestException('The workbook has no worksheets');
    }

    // `sheet.rows[i][j]` is sheet row i+1, column j+1; column indexes below are 0-based.
    const columnByIndex = new Map<number, keyof Omit<ParsedImportRow, 'row'>>();
    (sheet.rows[0] ?? []).forEach((cell, index) => {
      const field = HEADER_ALIASES[cellToText(cell).toLowerCase()];
      if (field) {
        columnByIndex.set(index, field);
      }
    });

    if (!columnByIndex.size) {
      throw new BadRequestException(
        'No recognized columns found in the header row (expected: name, email, ID, role, department, date of birth)',
      );
    }

    const hasDateOfBirthColumn = [...columnByIndex.values()].includes('dateOfBirth');
    const rows: ParsedImportRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rows.length; rowNumber++) {
      const row = sheet.rows[rowNumber - 1] ?? [];
      if (row.every((cell) => cellToText(cell) === '')) {
        continue; // skip fully blank rows
      }

      const parsed: ParsedImportRow = {
        row: rowNumber,
        name: null,
        email: null,
        externalId: null,
        roleCode: null,
        department: null,
        // Only present when the file has the column — otherwise an update leaves the stored value alone.
        ...(hasDateOfBirthColumn ? { dateOfBirth: null } : {}),
      };
      let hasAnyValue = false;
      for (const [colNumber, field] of columnByIndex) {
        const cellValue = row[colNumber];
        if (field === 'dateOfBirth') {
          const text = this.cellToDateText(cellValue);
          if (text !== null) {
            hasAnyValue = true;
            const normalized = normalizeDateOfBirth(text);
            if (normalized) parsed.dateOfBirth = normalized;
            else parsed.dateOfBirthInvalid = true;
          }
          continue;
        }
        const value = this.cellToString(cellValue);
        if (value !== null) hasAnyValue = true;
        (parsed as unknown as Record<string, string | null>)[field] = value;
      }
      if (hasAnyValue) {
        rows.push(parsed);
      }
    }

    return rows;
  }

  /**
   * Validates every row against the live DB — required fields, role code
   * existence, and the ID/email upsert-conflict rule (D30 edge case, resolved
   * per BUILD_PLAN.md §Phase 2: ID takes precedence, a row whose ID matches
   * one existing user but whose email matches a DIFFERENT existing user is
   * rejected). Writes nothing.
   */
  async validateRows(rows: ParsedImportRow[]): Promise<ImportReport> {
    const roles = await this.prisma.role.findMany({ select: { code: true } });
    const validRoleCodes = new Set(roles.map((r) => r.code));

    const results: ImportRowResult[] = [];
    // Tracks emails/externalIds already claimed by an earlier VALID row in
    // this same file, so two rows silently colliding with each other (not
    // just with the DB) is caught too, rather than surfacing as a confusing
    // unique-constraint error at commit time.
    const seenEmails = new Map<string, number>();
    const seenExternalIds = new Map<string, number>();

    for (const parsed of rows) {
      const result = await this.validateRow(parsed, validRoleCodes, seenEmails, seenExternalIds);
      results.push(result);
    }

    const validCount = results.filter((r) => r.valid).length;
    return {
      rows: results,
      validCount,
      invalidCount: results.length - validCount,
      allValid: results.length > 0 && validCount === results.length,
    };
  }

  private async validateRow(
    parsed: ParsedImportRow,
    validRoleCodes: Set<string>,
    seenEmails: Map<string, number>,
    seenExternalIds: Map<string, number>,
  ): Promise<ImportRowResult> {
    const base: ImportRowResult = { ...parsed, valid: false, error: null, action: null, matchedUserId: null };

    if (!parsed.name) {
      return { ...base, error: 'Missing required field: name' };
    }
    if (!parsed.email) {
      return { ...base, error: 'Missing required field: email' };
    }
    if (!EMAIL_RE.test(parsed.email)) {
      return { ...base, error: `Invalid email: ${parsed.email}` };
    }
    if (parsed.dateOfBirthInvalid) {
      return { ...base, error: 'Invalid date of birth (use YYYY-MM-DD; not in the future)' };
    }
    if (!parsed.roleCode) {
      return { ...base, error: 'Missing required field: role' };
    }
    if (!validRoleCodes.has(parsed.roleCode)) {
      return { ...base, error: `Unknown role code: ${parsed.roleCode}` };
    }

    const emailKey = parsed.email.toLowerCase();
    if (seenEmails.has(emailKey)) {
      return { ...base, error: `Duplicate email within this file (also used on row ${seenEmails.get(emailKey)})` };
    }
    if (parsed.externalId && seenExternalIds.has(parsed.externalId)) {
      return {
        ...base,
        error: `Duplicate ID within this file (also used on row ${seenExternalIds.get(parsed.externalId)})`,
      };
    }

    const matchByExternalId = parsed.externalId
      ? await this.prisma.user.findUnique({ where: { externalId: parsed.externalId } })
      : null;
    const matchByEmail = await this.prisma.user.findUnique({ where: { email: parsed.email } });

    if (matchByExternalId && matchByEmail && matchByExternalId.id !== matchByEmail.id) {
      return {
        ...base,
        error: `Row's ID matches an existing user (${matchByExternalId.email}) but its email matches a different existing user (${matchByEmail.email})`,
      };
    }

    seenEmails.set(emailKey, parsed.row);
    if (parsed.externalId) seenExternalIds.set(parsed.externalId, parsed.row);

    const matched = matchByExternalId ?? matchByEmail;
    return {
      ...base,
      valid: true,
      error: null,
      action: matched ? 'update' : 'create',
      matchedUserId: matched?.id ?? null,
    };
  }

  /**
   * Re-validates from scratch (never trusts a client-held preview payload)
   * and commits all-or-nothing in a single transaction: if ANY row is
   * invalid, nothing is written and the same per-row report is returned.
   */
  async commit(buffer: Buffer, importedBy: string): Promise<ImportReport> {
    const rows = await this.parseWorkbook(buffer);
    const report = await this.validateRows(rows);
    if (!report.allValid) {
      return report;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const row of report.rows) {
        const role = await tx.role.findUniqueOrThrow({ where: { code: row.roleCode! } });

        if (row.action === 'update' && row.matchedUserId) {
          await tx.user.update({
            where: { id: row.matchedUserId },
            data: {
              name: row.name!,
              email: row.email!,
              externalId: row.externalId,
              department: row.department,
              dateOfBirth: row.dateOfBirth === undefined ? undefined : row.dateOfBirth === null ? null : toDateOnly(row.dateOfBirth),
            },
          });
          await tx.userRole.upsert({
            where: { userId_roleId: { userId: row.matchedUserId, roleId: role.id } },
            update: {},
            create: { userId: row.matchedUserId, roleId: role.id, assignedBy: importedBy },
          });
        } else {
          // Bulk-created accounts get a random temporary password and must
          // change it at next login — same pattern as an admin-created user.
          const temporaryPassword = randomBytes(18).toString('base64url');
          const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
          const created = await tx.user.create({
            data: {
              name: row.name!,
              email: row.email!,
              externalId: row.externalId,
              department: row.department,
              dateOfBirth: row.dateOfBirth === undefined ? undefined : row.dateOfBirth === null ? null : toDateOnly(row.dateOfBirth),
              passwordHash,
              mustChangePassword: true,
              createdBy: importedBy,
            },
          });
          await tx.userRole.create({
            data: { userId: created.id, roleId: role.id, assignedBy: importedBy },
          });
        }
      }
    });

    return report;
  }

  async exportUsers(): Promise<Buffer> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { userRoles: { include: { role: true } } },
    });

    const exportRows: ExportRow[] = users.map((user) => ({
      name: user.name,
      email: user.email,
      externalId: user.externalId,
      role: user.userRoles.map((ur) => ur.role.code).join(','),
      department: user.department,
      dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
    }));

    return buildXlsx([
      {
        name: 'Users',
        header: ['name', 'email', 'id', 'role', 'department', 'date of birth'],
        widths: [24, 28, 18, 20, 20, 16],
        rows: exportRows.map((r) => [r.name, r.email, r.externalId, r.role, r.department, r.dateOfBirth]),
      },
    ]);
  }

  /** A date cell (Excel stores real dates) or text -> `YYYY-MM-DD`-ish text; null when blank. */
  private cellToDateText(value: unknown): string | null {
    return this.cellToString(value);
  }

  private cellToString(value: unknown): string | null {
    return cellToText(value) || null;
  }
}
