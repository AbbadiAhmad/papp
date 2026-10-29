import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { BookValues, ImportAction, RawImportRow, changedFields, isUuid, toBookValues } from './books-import-rules';
import { BooksService } from './books.service';

export interface BooksImportRowReport {
  row: number;
  id: string | null;
  title: string | null;
  action: ImportAction | null;
  /** Which fields would change (updates only). */
  changes: string[];
  valid: boolean;
  error: string | null;
}

export interface BooksImportReport {
  rows: BooksImportRowReport[];
  validCount: number;
  invalidCount: number;
  allValid: boolean;
  /** Filled by a commit only. */
  created?: number;
  updated?: number;
}

const MAX_ROWS = 5000;
const FIELD_ORDER: Record<string, string> = { readingLevel: 'reading_level', pageCount: 'page_count' };

/**
 * Imports the Excel file the books export produces (LIBRARY_CATALOG-D31): preview first (writes nothing), then
 * an all-or-nothing commit — any invalid row stops the whole import, same flow as core's Users import (D42).
 */
@Injectable()
export class BooksImportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BooksImportService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly books: BooksService) {}

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
      if (name) columns.set(name, col);
    });
    if (!columns.has('title')) throw new BadRequestException('The first row must contain a "title" column (use the file produced by the export)');
    if (sheet.rowCount - 1 > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows can be imported at once`);

    const rows: RawImportRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const excelRow = sheet.getRow(r);
      const cells: Record<string, string> = {};
      let any = false;
      for (const [name, col] of columns) {
        const text = this.cellText(excelRow.getCell(col).value);
        cells[name] = text;
        if (text) any = true;
      }
      if (any) rows.push({ row: r, id: (cells.id ?? '').trim(), cells });
    }
    return rows;
  }

  private cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
      if ('text' in value && typeof value.text === 'string') return value.text.trim();
      if ('result' in value && value.result !== undefined) return String(value.result).trim();
      if (value instanceof Date) return value.toISOString();
      return '';
    }
    return String(value).trim();
  }

  /** Validates every row against the current catalog; writes nothing. */
  async preview(buffer: Buffer): Promise<{ report: BooksImportReport; plan: PlannedRow[] }> {
    const raw = await this.parseWorkbook(buffer);
    const ids = raw.map((r) => r.id).filter((id) => isUuid(id));
    const existing = ids.length ? await this.prisma.libraryCatalogBook.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(existing.map((book) => [book.id, book]));
    const seen = new Set<string>();

    const plan: PlannedRow[] = raw.map((r) => {
      const base = { row: r.row, id: r.id || null, changes: [] as string[] };
      const parsed = toBookValues(r.cells);
      const title = (r.cells.title ?? '').trim() || null;
      const fail = (error: string): PlannedRow => ({ ...base, title, action: null, valid: false, error, values: null });
      if ('error' in parsed) return fail(parsed.error);
      if (r.id) {
        if (!isUuid(r.id)) return fail('id is not a valid book id (leave it blank to add a new book)');
        if (seen.has(r.id)) return fail('this id appears more than once in the file');
        seen.add(r.id);
        const book = byId.get(r.id);
        if (!book) return fail('no book with this id exists');
        const current: BookValues = {
          title: book.title,
          author: book.author,
          publisher: book.publisher,
          category: book.category,
          readingLevel: book.readingLevel,
          language: book.language,
          pageCount: book.pageCount,
        };
        const changes = changedFields(current, parsed.values).map((key) => FIELD_ORDER[key] ?? key);
        return { ...base, title: parsed.values.title, changes, action: changes.length ? 'update' : 'unchanged', valid: true, error: null, values: parsed.values };
      }
      return { ...base, title: parsed.values.title, action: 'create', valid: true, error: null, values: parsed.values };
    });

    const validCount = plan.filter((p) => p.valid).length;
    const report: BooksImportReport = {
      rows: plan.map(({ values: _values, ...rest }) => rest),
      validCount,
      invalidCount: plan.length - validCount,
      allValid: plan.length > 0 && validCount === plan.length,
    };
    return { report, plan };
  }

  async commit(buffer: Buffer): Promise<BooksImportReport> {
    const { report, plan } = await this.preview(buffer);
    if (!report.allValid) return report;
    let created = 0;
    let updated = 0;
    for (const row of plan) {
      const v = row.values!;
      if (row.action === 'update') {
        await this.prisma.libraryCatalogBook.update({
          where: { id: row.id! },
          data: { title: v.title, author: v.author, publisher: v.publisher, category: v.category, readingLevel: v.readingLevel, language: v.language, pageCount: v.pageCount },
        });
        updated += 1;
      } else if (row.action === 'create') {
        // Same rule as the Add Book form: every book comes with its first copy; no code given, so the server numbers it.
        await this.books.create({
          title: v.title,
          author: v.author ?? undefined,
          publisher: v.publisher ?? undefined,
          category: v.category ?? undefined,
          readingLevel: v.readingLevel ?? undefined,
          language: v.language ?? undefined,
          pageCount: v.pageCount ?? undefined,
          copy: {},
        } as Parameters<BooksService['create']>[0]);
        created += 1;
      }
    }
    this.logger.log(`books import: ${created} created, ${updated} updated`);
    return { ...report, created, updated };
  }
}

export interface PlannedRow extends BooksImportRowReport {
  values: BookValues | null;
}
