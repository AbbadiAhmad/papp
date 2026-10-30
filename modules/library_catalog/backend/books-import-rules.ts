/**
 * Pure rules for the books Excel export/import (LIBRARY_CATALOG-D31, reworked in D32). Framework-free so the
 * service and the unit tests share it.
 *
 * File format: ONE ROW PER COPY. Every row carries the book's data followed by that copy's data; a book with
 * several copies repeats its book columns on each row, a book with no copies has one row with blank copy
 * columns. `planImport` groups rows into books, compares them with the catalog and returns, for every book and
 * copy, what would be created/updated, the field-by-field differences (current vs incoming) and any
 * inconsistencies — it never writes anything. The user then decides what to apply (see the service).
 */
export const BOOK_COLUMNS = ['id', 'title', 'author', 'publisher', 'category', 'reading_level', 'language', 'description', 'page_count'] as const;
export const COPY_COLUMNS = ['copy_id', 'copy_code', 'copy_status', 'copy_condition', 'copy_location', 'copy_acquisition_date'] as const;
/** Book fields a user can change through the import (the id never changes). */
export const BOOK_FIELDS = ['title', 'author', 'publisher', 'category', 'reading_level', 'language', 'description', 'page_count'] as const;
export const COPY_FIELDS = ['copy_code', 'copy_status', 'copy_condition', 'copy_location', 'copy_acquisition_date'] as const;
export const COPY_STATUSES = ['available', 'borrowed', 'lost', 'damaged', 'maintenance', 'reserved'] as const;

export interface RawImportRow {
  row: number;
  cells: Record<string, string>;
}

export interface BookValues {
  title: string;
  author: string | null;
  publisher: string | null;
  category: string | null;
  readingLevel: string | null;
  language: string | null;
  description: string | null;
  pageCount: number | null;
}

export interface CopyValues {
  code: string | null;
  status: string;
  condition: string | null;
  location: string | null;
  acquisitionDate: string | null;
}

export interface DbBook {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  category: string | null;
  readingLevel: string | null;
  language: string | null;
  description: string | null;
  pageCount: number | null;
}

export interface DbCopy {
  id: string;
  bookId: string;
  qrCode: string;
  status: string;
  condition: string | null;
  location: string | null;
  /** YYYY-MM-DD */
  acquisitionDate: string | null;
}

export interface Issue {
  level: 'error' | 'warning' | 'info';
  message: string;
}

export interface FieldDiff {
  /** The Excel column name, which is also the key of a decision's field overrides. */
  field: string;
  current: string | null;
  incoming: string | null;
  differs: boolean;
  /** True when the value cannot be changed through the import (e.g. a status involving "borrowed"). */
  locked: boolean;
}

export type PlanAction = 'create' | 'update' | 'unchanged' | 'error';

export interface CopyPlan {
  key: string;
  rows: number[];
  action: PlanAction;
  copyId: string | null;
  code: string | null;
  fields: FieldDiff[];
  issues: Issue[];
  /** Normalised incoming cells, the base for a decision's overrides. */
  incoming: Record<string, string>;
}

export interface BookPlan {
  key: string;
  rows: number[];
  action: PlanAction;
  bookId: string | null;
  title: string | null;
  fields: FieldDiff[];
  issues: Issue[];
  incoming: Record<string, string>;
  /** The stored values as cells (update only) — the base for a decision's overrides. */
  current: Record<string, string> | null;
  copies: CopyPlan[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (value: string | null | undefined): string => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const text = (value: string | null | undefined): string => (value ?? '').trim();
const orNull = (value: string | null | undefined): string | null => (text(value) ? text(value) : null);

export function toBookValues(cells: Record<string, string>): { values: BookValues } | { error: string } {
  const title = text(cells.title);
  if (!title) return { error: 'title is required' };
  let pageCount: number | null = null;
  const rawPages = text(cells.page_count);
  if (rawPages) {
    const parsed = Number(rawPages);
    if (!Number.isInteger(parsed) || parsed < 1) return { error: 'page_count must be a whole number of at least 1' };
    pageCount = parsed;
  }
  return {
    values: {
      title,
      author: orNull(cells.author),
      publisher: orNull(cells.publisher),
      category: orNull(cells.category),
      readingLevel: orNull(cells.reading_level),
      language: orNull(cells.language),
      description: orNull(cells.description),
      pageCount,
    },
  };
}

/** `blankStatus` is what an empty status cell means: 'available' for a new copy, the current status for an existing one. */
export function toCopyValues(cells: Record<string, string>, blankStatus: string): { values: CopyValues } | { error: string } {
  const status = text(cells.copy_status).toLowerCase() || blankStatus;
  if (!(COPY_STATUSES as readonly string[]).includes(status)) return { error: `copy_status "${cells.copy_status}" is not one of ${COPY_STATUSES.join(', ')}` };
  const date = text(cells.copy_acquisition_date);
  if (date && (!DATE.test(date) || Number.isNaN(new Date(date).getTime()))) return { error: 'copy_acquisition_date must be a date written YYYY-MM-DD' };
  return { values: { code: orNull(cells.copy_code), status, condition: orNull(cells.copy_condition), location: orNull(cells.copy_location), acquisitionDate: date || null } };
}

export const bookToCells = (book: DbBook): Record<string, string> => ({
  title: book.title,
  author: book.author ?? '',
  publisher: book.publisher ?? '',
  category: book.category ?? '',
  reading_level: book.readingLevel ?? '',
  language: book.language ?? '',
  description: book.description ?? '',
  page_count: book.pageCount == null ? '' : String(book.pageCount),
});

export const copyToCells = (copy: DbCopy): Record<string, string> => ({
  copy_code: copy.qrCode,
  copy_status: copy.status,
  copy_condition: copy.condition ?? '',
  copy_location: copy.location ?? '',
  copy_acquisition_date: copy.acquisitionDate ?? '',
});

const hasCopyData = (cells: Record<string, string>): boolean => COPY_COLUMNS.some((c) => text(cells[c]));

function diffFields(fields: readonly string[], current: Record<string, string> | null, incoming: Record<string, string>, locked: string[] = []): FieldDiff[] {
  return fields.map((field) => {
    const before = current ? orNull(current[field]) : null;
    const after = orNull(incoming[field]);
    return { field, current: before, incoming: after, differs: current ? before !== after : after !== null, locked: locked.includes(field) };
  });
}

export interface ImportSnapshot {
  books: DbBook[];
  copies: DbCopy[];
}

/** Groups the file's rows into books and compares everything with the catalog. Pure: writes nothing. */
export function planImport(rows: RawImportRow[], db: ImportSnapshot): BookPlan[] {
  const booksById = new Map(db.books.map((b) => [b.id.toLowerCase(), b]));
  const copiesById = new Map(db.copies.map((c) => [c.id.toLowerCase(), c]));
  const copiesByCode = new Map(db.copies.map((c) => [c.qrCode, c]));
  const bookTitleById = new Map(db.books.map((b) => [b.id, b.title]));
  const copiesOfBook = new Map<string, DbCopy[]>();
  for (const c of db.copies) copiesOfBook.set(c.bookId, [...(copiesOfBook.get(c.bookId) ?? []), c]);
  const similar = new Map<string, DbBook>();
  for (const b of db.books) similar.set(`${norm(b.title)}|${norm(b.author)}|${norm(b.publisher)}`, b);

  const groups = new Map<string, RawImportRow[]>();
  for (const r of rows) {
    const id = text(r.cells.id).toLowerCase();
    const key = id ? `id:${id}` : `new:${norm(r.cells.title)}|${norm(r.cells.author)}|${norm(r.cells.publisher)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const seenCopyIds = new Map<string, number>();
  const seenCodes = new Map<string, number>();
  const plans: BookPlan[] = [];
  let bookIndex = 0;

  for (const [groupKey, groupRows] of groups) {
    bookIndex += 1;
    const key = `b${bookIndex}`;
    const first = groupRows[0];
    const issues: Issue[] = [];
    const incoming: Record<string, string> = {};
    for (const f of BOOK_FIELDS) incoming[f] = text(first.cells[f]);

    // The same book on several rows must agree; if it doesn't, the first row wins and the user is told.
    for (const f of BOOK_FIELDS) {
      const clashing = groupRows.filter((r) => norm(r.cells[f]) !== norm(first.cells[f]));
      if (clashing.length) {
        issues.push({ level: 'warning', message: `${f} differs between rows ${[first.row, ...clashing.map((r) => r.row)].join(', ')} of the same book; the value from row ${first.row} is used — edit it below if needed` });
      }
    }

    const rawId = text(first.cells.id);
    let dbBook: DbBook | undefined;
    let action: PlanAction = 'create';
    if (groupKey.startsWith('id:')) {
      if (!isUuid(rawId)) {
        issues.push({ level: 'error', message: 'id is not a valid book id (leave it blank to add a new book)' });
        action = 'error';
      } else {
        dbBook = booksById.get(rawId.toLowerCase());
        if (!dbBook) {
          issues.push({ level: 'error', message: 'no book with this id exists (leave id blank to add it as a new book)' });
          action = 'error';
        }
      }
    }
    const parsed = toBookValues(incoming);
    if ('error' in parsed) {
      issues.push({ level: 'error', message: parsed.error });
      action = 'error';
    }
    if (!rawId && 'values' in parsed) {
      const twin = similar.get(`${norm(parsed.values.title)}|${norm(parsed.values.author)}|${norm(parsed.values.publisher)}`);
      if (twin) issues.push({ level: 'warning', message: `a book with the same title, author and publisher already exists (id ${twin.id}); importing would create a duplicate — put its id in the id column to update it instead` });
    }

    const current = dbBook ? bookToCells(dbBook) : null;
    const fields = diffFields(BOOK_FIELDS, current, incoming);
    if (action !== 'error') action = dbBook ? (fields.some((f) => f.differs) ? 'update' : 'unchanged') : 'create';

    const copies: CopyPlan[] = [];
    let copyIndex = 0;
    for (const r of groupRows) {
      if (!hasCopyData(r.cells)) continue;
      copyIndex += 1;
      const cIssues: Issue[] = [];
      const cIncoming: Record<string, string> = {};
      for (const f of COPY_FIELDS) cIncoming[f] = text(r.cells[f]);
      const rawCopyId = text(r.cells.copy_id);
      const code = text(r.cells.copy_code);
      let dbCopy: DbCopy | undefined;
      let cAction: PlanAction = 'create';

      if (rawCopyId) {
        if (!isUuid(rawCopyId)) {
          cIssues.push({ level: 'error', message: 'copy_id is not a valid copy id (leave it blank to add a new copy)' });
          cAction = 'error';
        } else {
          dbCopy = copiesById.get(rawCopyId.toLowerCase());
          if (!dbCopy) {
            cIssues.push({ level: 'error', message: 'no copy with this copy_id exists (leave copy_id blank to add it as a new copy)' });
            cAction = 'error';
          } else if (!dbBook || dbCopy.bookId !== dbBook.id) {
            cIssues.push({ level: 'error', message: `this copy belongs to ${bookTitleById.has(dbCopy.bookId) ? `"${bookTitleById.get(dbCopy.bookId)}"` : 'another book'}, not to the book on this row` });
            cAction = 'error';
          }
          const dupRow = seenCopyIds.get(rawCopyId.toLowerCase());
          if (dupRow) {
            cIssues.push({ level: 'error', message: `copy_id also appears on row ${dupRow}` });
            cAction = 'error';
          }
          seenCopyIds.set(rawCopyId.toLowerCase(), r.row);
        }
      } else if (code) {
        const byCode = copiesByCode.get(code);
        if (byCode) {
          if (dbBook && byCode.bookId === dbBook.id) {
            dbCopy = byCode;
            cIssues.push({ level: 'warning', message: `copy_id is blank; matched the existing copy by its code "${code}"` });
          } else {
            cIssues.push({ level: 'error', message: `code "${code}" is already used by ${bookTitleById.has(byCode.bookId) ? `"${bookTitleById.get(byCode.bookId)}"` : 'another book'}` });
            cAction = 'error';
          }
        }
      } else {
        cIssues.push({ level: 'info', message: 'no code given; the next free code is assigned when imported' });
      }

      if (code) {
        const dupRow = seenCodes.get(code);
        if (dupRow) {
          cIssues.push({ level: 'error', message: `code "${code}" also appears on row ${dupRow}` });
          cAction = 'error';
        }
        seenCodes.set(code, r.row);
        const owner = copiesByCode.get(code);
        if (dbCopy && owner && owner.id !== dbCopy.id) {
          cIssues.push({ level: 'error', message: `code "${code}" is already used by another copy` });
          cAction = 'error';
        }
      }

      const locked: string[] = [];
      const cCurrent = dbCopy ? copyToCells(dbCopy) : null;
      const cParsed = toCopyValues(cIncoming, dbCopy?.status ?? 'available');
      if ('error' in cParsed) {
        cIssues.push({ level: 'error', message: cParsed.error });
        cAction = 'error';
      } else if (dbCopy) {
        // "borrowed" is set and cleared by lending/returning, never by a spreadsheet.
        if (cParsed.values.status !== dbCopy.status && (dbCopy.status === 'borrowed' || cParsed.values.status === 'borrowed')) {
          locked.push('copy_status');
          cIssues.push({ level: 'warning', message: `status ${dbCopy.status} → ${cParsed.values.status} is not applied: "borrowed" is only changed by lending and returning` });
        }
      } else if (cParsed.values.status === 'borrowed') {
        cIssues.push({ level: 'error', message: 'a new copy cannot start as "borrowed"; lend it from the circulation desk' });
        cAction = 'error';
      }
      if ('values' in cParsed) cIncoming.copy_status = cParsed.values.status;

      const cFields = diffFields(COPY_FIELDS, cCurrent, cIncoming, locked);
      if (cAction !== 'error') cAction = dbCopy ? (cFields.some((f) => f.differs && !f.locked) ? 'update' : 'unchanged') : 'create';
      copies.push({ key: `${key}c${copyIndex}`, rows: [r.row], action: cAction, copyId: dbCopy?.id ?? null, code: code || dbCopy?.qrCode || null, fields: cFields, issues: cIssues, incoming: cIncoming });
    }

    if (dbBook) {
      const inFile = new Set(copies.map((c) => c.copyId).filter(Boolean));
      const missing = (copiesOfBook.get(dbBook.id) ?? []).filter((c) => !inFile.has(c.id));
      if (missing.length) issues.push({ level: 'info', message: `${missing.length} existing copy/copies of this book are not in the file and are left untouched (${missing.slice(0, 5).map((c) => c.qrCode).join(', ')}${missing.length > 5 ? ', …' : ''})` });
    }

    plans.push({ key, rows: groupRows.map((r) => r.row), action, bookId: dbBook?.id ?? null, title: text(first.cells.title) || null, fields, issues, incoming, current, copies });
  }
  return plans;
}

/** What the user chose for one book/copy: apply it or not, and the final text of each field they want written. */
export interface ItemDecision {
  apply: boolean;
  fields?: Record<string, string>;
}
export interface ImportDecisions {
  books: Record<string, ItemDecision & { copies?: Record<string, ItemDecision> }>;
}
