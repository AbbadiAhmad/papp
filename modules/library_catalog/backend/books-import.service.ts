import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LibraryCatalogBookCopyStatus, Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  BOOK_COLUMNS,
  BOOK_FIELDS,
  BookPlan,
  COPY_COLUMNS,
  COPY_FIELDS,
  ImportDecisions,
  ImportSnapshot,
  ItemDecision,
  RawImportRow,
  planImport,
  toBookValues,
  toCopyValues,
} from './books-import-rules';
import { BookFilesService } from './book-files.service';
import { BooksService } from './books.service';

export interface BooksImportReport {
  books: BookPlan[];
  errorCount: number;
  warningCount: number;
  /** Filled by a commit only. */
  result?: { booksCreated: number; booksUpdated: number; copiesCreated: number; copiesUpdated: number; skipped: number };
}

const MAX_ROWS = 20000;
const KNOWN_COLUMNS = new Set<string>([...BOOK_COLUMNS, ...COPY_COLUMNS]);

/**
 * Imports the one-row-per-copy Excel file the export produces (LIBRARY_CATALOG-D32). Two steps:
 *  - `preview`: groups rows into books, compares with the catalog and flags inconsistencies; writes nothing.
 *  - `commit`: the same file plus the user's decisions (which books/copies to apply, and the final text of each
 *    field they chose to write). The plan is recomputed from the file, every final value is validated again, and
 *    everything is written in ONE transaction — a failure leaves the catalog untouched.
 */
@Injectable()
export class BooksImportService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  constructor(
    private readonly books: BooksService,
    private readonly files: BookFilesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async parseWorkbook(buffer: Buffer): Promise<RawImportRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('The file is not a readable .xlsx workbook');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('The workbook has no sheet');
    const columns = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, col) => {
      const name = this.cellText(cell.value).toLowerCase();
      if (KNOWN_COLUMNS.has(name)) columns.set(name, col);
    });
    if (!columns.has('title')) throw new BadRequestException('The first row must contain a "title" column (use the file produced by the export)');
    if (sheet.rowCount - 1 > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows can be imported at once`);

    const rows: RawImportRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const excelRow = sheet.getRow(r);
      const cells: Record<string, string> = {};
      let any = false;
      for (const [name, col] of columns) {
        const value = excelRow.getCell(col).value;
        const cellText = name === 'copy_acquisition_date' && value instanceof Date ? value.toISOString().slice(0, 10) : this.cellText(value);
        cells[name] = cellText;
        if (cellText) any = true;
      }
      if (any) rows.push({ row: r, cells });
    }
    return rows;
  }

  private cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
      if ('text' in value && typeof value.text === 'string') return value.text.trim();
      if ('result' in value && value.result !== undefined) return String(value.result).trim();
      return '';
    }
    return String(value).trim();
  }

  private async snapshot(): Promise<ImportSnapshot> {
    const [books, copies] = await Promise.all([
      this.prisma.libraryCatalogBook.findMany({
        select: { id: true, title: true, author: true, publisher: true, category: true, readingLevel: true, language: true, description: true, pageCount: true },
      }),
      this.prisma.libraryCatalogBookCopy.findMany({ select: { id: true, bookId: true, qrCode: true, status: true, condition: true, location: true, acquisitionDate: true } }),
    ]);
    return {
      books,
      copies: copies.map((c) => ({ ...c, acquisitionDate: c.acquisitionDate ? c.acquisitionDate.toISOString().slice(0, 10) : null })),
    };
  }

  private report(plans: BookPlan[]): BooksImportReport {
    const issues = plans.flatMap((b) => [...b.issues, ...b.copies.flatMap((c) => c.issues)]);
    return {
      books: plans,
      errorCount: issues.filter((i) => i.level === 'error').length,
      warningCount: issues.filter((i) => i.level === 'warning').length,
    };
  }

  /** Validates and compares only — writes nothing. */
  async preview(buffer: Buffer): Promise<BooksImportReport> {
    return this.report(planImport(await this.parseWorkbook(buffer), await this.snapshot()));
  }

  async commit(buffer: Buffer, decisions: ImportDecisions): Promise<BooksImportReport> {
    const plans = planImport(await this.parseWorkbook(buffer), await this.snapshot());
    const renamed: string[] = [];
    const result = { booksCreated: 0, booksUpdated: 0, copiesCreated: 0, copiesUpdated: 0, skipped: 0 };

    // Only the cells the user ticked are written; the rest stay as stored (update) or as in the file (create).
    const merged = (base: Record<string, string>, decision: ItemDecision, allowed: readonly string[], locked: string[]) => {
      const out = { ...base };
      for (const [field, value] of Object.entries(decision.fields ?? {})) {
        if (allowed.includes(field) && !locked.includes(field)) out[field] = String(value ?? '').trim();
      }
      return out;
    };

    try {
      await this.prisma.$transaction(
        async (tx) => {
          for (const plan of plans) {
            const bookDecision = decisions.books?.[plan.key];
            let bookId = plan.bookId;
            if (bookDecision?.apply && plan.action !== 'unchanged') {
              if (plan.action === 'error') throw new BadRequestException(`"${plan.title ?? `row ${plan.rows[0]}`}" has errors and cannot be imported`);
              const cells = plan.action === 'create' ? merged(plan.incoming, bookDecision, BOOK_FIELDS, []) : merged(plan.current!, bookDecision, BOOK_FIELDS, []);
              const parsed = toBookValues(cells);
              if ('error' in parsed) throw new BadRequestException(`"${plan.title ?? `row ${plan.rows[0]}`}": ${parsed.error}`);
              const data = parsed.values;
              if (plan.action === 'create') {
                bookId = (await tx.libraryCatalogBook.create({ data })).id;
                result.booksCreated += 1;
              } else {
                await tx.libraryCatalogBook.update({ where: { id: plan.bookId! }, data });
                renamed.push(plan.bookId!);
                result.booksUpdated += 1;
              }
            } else if (plan.action === 'create' || plan.action === 'update' || plan.action === 'error') {
              if (plan.action !== 'update') result.skipped += 1;
            }

            for (const copyPlan of plan.copies) {
              const decision = bookDecision?.copies?.[copyPlan.key];
              if (!decision?.apply || copyPlan.action === 'unchanged') continue;
              if (copyPlan.action === 'error') throw new BadRequestException(`Row ${copyPlan.rows[0]} (copy) has errors and cannot be imported`);
              if (!bookId) {
                result.skipped += 1; // its new book was not applied, so there is nothing to attach the copy to
                continue;
              }
              const locked = copyPlan.fields.filter((f) => f.locked).map((f) => f.field);
              let existing = copyPlan.copyId ? await tx.libraryCatalogBookCopy.findUnique({ where: { id: copyPlan.copyId } }) : null;
              const currentCells = existing
                ? {
                    copy_code: existing.qrCode,
                    copy_status: existing.status,
                    copy_condition: existing.condition ?? '',
                    copy_location: existing.location ?? '',
                    copy_acquisition_date: existing.acquisitionDate ? existing.acquisitionDate.toISOString().slice(0, 10) : '',
                  }
                : null;
              const cells = merged(currentCells ?? copyPlan.incoming, decision, COPY_FIELDS, locked);
              const parsed = toCopyValues(cells, existing?.status ?? 'available');
              if ('error' in parsed) throw new BadRequestException(`Row ${copyPlan.rows[0]} (copy): ${parsed.error}`);
              const v = parsed.values;

              if (!existing) {
                const qrCode = v.code ?? (await this.books.nextCopyCode(tx as unknown as Pick<PrismaClient, '$queryRawUnsafe'>));
                if (v.code) await this.books.reconcileCopyCodeSequence(tx as unknown as Pick<PrismaClient, '$queryRawUnsafe'>, v.code);
                await tx.libraryCatalogBookCopy.create({
                  data: {
                    bookId,
                    qrCode,
                    status: v.status as LibraryCatalogBookCopyStatus,
                    condition: v.condition,
                    location: v.location,
                    acquisitionDate: v.acquisitionDate ? new Date(v.acquisitionDate) : null,
                  },
                });
                result.copiesCreated += 1;
              } else {
                const code = v.code ?? existing.qrCode;
                const changes: Record<string, { before: unknown; after: unknown }> = {};
                if (v.status !== existing.status) changes.status = { before: existing.status, after: v.status };
                if (v.condition !== existing.condition) changes.condition = { before: existing.condition, after: v.condition };
                if (v.location !== existing.location) changes.location = { before: existing.location, after: v.location };
                if (code !== existing.qrCode) changes.qrCode = { before: existing.qrCode, after: code };
                const before = existing.acquisitionDate ? existing.acquisitionDate.toISOString().slice(0, 10) : null;
                if (v.acquisitionDate !== before) changes.acquisitionDate = { before, after: v.acquisitionDate };
                const history = (Array.isArray(existing.history) ? existing.history : []) as Record<string, unknown>[];
                const nextHistory = Object.keys(changes).length ? [...history, { timestamp: new Date().toISOString(), changes, source: 'import' }].slice(-100) : history;
                if (code !== existing.qrCode) await this.books.reconcileCopyCodeSequence(tx as unknown as Pick<PrismaClient, '$queryRawUnsafe'>, code);
                existing = await tx.libraryCatalogBookCopy.update({
                  where: { id: existing.id },
                  data: {
                    qrCode: code,
                    status: v.status as LibraryCatalogBookCopyStatus,
                    condition: v.condition,
                    location: v.location,
                    acquisitionDate: v.acquisitionDate ? new Date(v.acquisitionDate) : null,
                    history: nextHistory as unknown as Prisma.InputJsonValue,
                  },
                });
                result.copiesUpdated += 1;
              }
            }
          }
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A copy code in the file is already used by another copy — nothing was imported. Run the preview again.');
      }
      throw error;
    }
    for (const id of renamed) await this.files.writeInfo(id); // keeps each book folder's info.txt (title/author) in step
    return { ...this.report(plans), result };
  }
}
