/**
 * Pure rules for the books Excel import (LIBRARY_CATALOG-D31): the workbook is the one the export produces, so a
 * librarian can export, edit cells and import it back. Framework-free so the service and the unit tests share it.
 *
 * A row with an `id` that exists updates that book (only the columns that differ); a row with no `id` creates a
 * new book with one auto-coded copy. Cells of optional columns that are blank clear the field. `total_copies`
 * and any unknown column are ignored (copies are managed on the book's page).
 */
export const TEXT_FIELDS = ['title', 'author', 'publisher', 'category', 'reading_level', 'language'] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export interface BookValues {
  title: string;
  author: string | null;
  publisher: string | null;
  category: string | null;
  readingLevel: string | null;
  language: string | null;
  pageCount: number | null;
}

export interface RawImportRow {
  row: number;
  id: string;
  cells: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

/** Turns one raw row into book values, or says why it is invalid. */
export function toBookValues(cells: Record<string, string>): { values: BookValues } | { error: string } {
  const title = (cells.title ?? '').trim();
  if (!title) return { error: 'title is required' };
  const optional = (key: string): string | null => {
    const value = (cells[key] ?? '').trim();
    return value ? value : null;
  };
  let pageCount: number | null = null;
  const rawPages = (cells.page_count ?? '').trim();
  if (rawPages) {
    const parsed = Number(rawPages);
    if (!Number.isInteger(parsed) || parsed < 1) return { error: 'page_count must be a whole number of at least 1' };
    pageCount = parsed;
  }
  return {
    values: {
      title,
      author: optional('author'),
      publisher: optional('publisher'),
      category: optional('category'),
      readingLevel: optional('reading_level'),
      language: optional('language'),
      pageCount,
    },
  };
}

export type ImportAction = 'create' | 'update' | 'unchanged';

/** The names of the fields whose value differs between the stored book and the imported row. */
export function changedFields(current: BookValues, next: BookValues): (keyof BookValues)[] {
  return (Object.keys(next) as (keyof BookValues)[]).filter((key) => (current[key] ?? null) !== (next[key] ?? null));
}
