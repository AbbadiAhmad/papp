import { describe, expect, it } from '@jest/globals';
import { DbBook, DbCopy, RawImportRow, isUuid, planImport, toBookValues, toCopyValues } from '../../backend/books-import-rules';

const B1 = '3f2b8c1e-9a4d-4b7e-8c21-0d5e6f7a8b9c';
const B2 = '4a2b8c1e-9a4d-4b7e-8c21-0d5e6f7a8b9c';
const C1 = '5f2b8c1e-9a4d-4b7e-8c21-0d5e6f7a8b9c';
const C2 = '6f2b8c1e-9a4d-4b7e-8c21-0d5e6f7a8b9c';
const C3 = '7f2b8c1e-9a4d-4b7e-8c21-0d5e6f7a8b9c';

const book = (id: string, title: string, extra: Partial<DbBook> = {}): DbBook => ({
  id, title, author: 'Author', publisher: null, category: null, readingLevel: null, language: null, description: null, pageCount: 100, internalNote: null, ...extra,
});
const copy = (id: string, bookId: string, qrCode: string, extra: Partial<DbCopy> = {}): DbCopy => ({
  id, bookId, qrCode, status: 'available', condition: null, location: null, acquisitionDate: null, internalNote: null, ...extra,
});
const row = (n: number, cells: Record<string, string>): RawImportRow => ({ row: n, cells });
const db = {
  books: [book(B1, 'Alpha'), book(B2, 'Beta')],
  copies: [copy(C1, B1, 'B000001'), copy(C2, B1, 'B000002', { location: 'Shelf 1' }), copy(C3, B2, 'B000003', { status: 'borrowed' })],
};

describe('planImport', () => {
  it('groups the rows of one book and lists its copies under it', () => {
    const plans = planImport(
      [
        row(2, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', copy_id: C1, copy_code: 'B000001', copy_status: 'available' }),
        row(3, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', copy_id: C2, copy_code: 'B000002', copy_status: 'available', copy_location: 'Shelf 1' }),
      ],
      db,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].action).toBe('unchanged');
    expect(plans[0].copies.map((c) => c.action)).toEqual(['unchanged', 'unchanged']);
  });

  it('shows current vs incoming for a changed book and a changed copy', () => {
    const [plan] = planImport([row(2, { id: B1, title: 'Alpha 2', author: 'Author', page_count: '100', copy_id: C2, copy_code: 'B000002', copy_status: 'damaged', copy_location: 'Shelf 1' })], db);
    expect(plan.action).toBe('update');
    expect(plan.fields.find((f) => f.field === 'title')).toMatchObject({ current: 'Alpha', incoming: 'Alpha 2', differs: true });
    expect(plan.copies[0].action).toBe('update');
    expect(plan.copies[0].fields.find((f) => f.field === 'copy_status')).toMatchObject({ current: 'available', incoming: 'damaged', differs: true });
    expect(plan.issues.some((i) => i.level === 'info' && i.message.includes('B000001'))).toBe(true);
  });

  it('flags rows of the same book that disagree, using the first row', () => {
    const [plan] = planImport([row(2, { id: B1, title: 'Alpha', author: 'Author', page_count: '100' }), row(3, { id: B1, title: 'Alpha', author: 'Someone else', page_count: '100' })], db);
    expect(plan.issues.some((i) => i.level === 'warning' && i.message.includes('author differs between rows 2, 3'))).toBe(true);
    expect(plan.incoming.author).toBe('Author');
  });

  it('creates a new book and a new copy (code optional) and warns about a likely duplicate', () => {
    const [fresh, dup] = planImport([row(2, { title: 'Gamma', copy_location: 'Shelf 2' }), row(3, { title: 'alpha', author: ' author ' })], db);
    expect(fresh.action).toBe('create');
    expect(fresh.copies[0]).toMatchObject({ action: 'create', code: null });
    expect(dup.issues.some((i) => i.level === 'warning' && i.message.includes(B1))).toBe(true);
  });

  it('keeps a book without copies as a book-only row', () => {
    const [plan] = planImport([row(2, { id: B1, title: 'Alpha', author: 'Author', page_count: '100' })], db);
    expect(plan.copies).toEqual([]);
  });

  it('errors on unknown ids, copies of another book, taken or duplicated codes and bad values', () => {
    const plans = planImport(
      [
        row(2, { id: '9f2b8c1e-9a4d-4b7e-8c21-0d5e6f7a8b9c', title: 'Ghost' }),
        row(3, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', copy_id: C3 }),
        row(4, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', copy_code: 'B000003' }),
        row(5, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', copy_code: 'NEW1' }),
        row(6, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', copy_code: 'NEW1' }),
        row(7, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', copy_code: 'NEW2', copy_status: 'broken', copy_acquisition_date: '31/12/2025' }),
        row(8, { title: ' ', copy_code: 'X' }),
      ],
      db,
    );
    const ghost = plans.find((p) => p.title === 'Ghost')!;
    expect(ghost.action).toBe('error');
    const alpha = plans.find((p) => p.bookId === B1)!;
    const messages = alpha.copies.map((c) => c.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' | '));
    expect(messages[0]).toContain('belongs to "Beta"');
    expect(messages[1]).toContain('already used by "Beta"');
    expect(alpha.copies[2].action).toBe('create');
    expect(messages[3]).toContain('also appears on row 5');
    expect(messages[4]).toContain('copy_status');
    expect(plans[plans.length - 1].issues.some((i) => i.message === 'title is required')).toBe(true);
  });

  it('locks a status change that involves "borrowed"', () => {
    const [plan] = planImport([row(2, { id: B2, title: 'Beta', author: 'Author', page_count: '100', copy_id: C3, copy_code: 'B000003', copy_status: 'available' })], db);
    const c = plan.copies[0];
    expect(c.action).toBe('unchanged');
    expect(c.fields.find((f) => f.field === 'copy_status')).toMatchObject({ locked: true, differs: true });
    expect(c.issues.some((i) => i.level === 'warning')).toBe(true);
  });

  it('rejects a new copy that starts as borrowed', () => {
    const [plan] = planImport([row(2, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', copy_code: 'Z1', copy_status: 'borrowed' })], db);
    expect(plan.copies[0].action).toBe('error');
  });
});

describe('internal notes (LIBRARY_CATALOG-D35)', () => {
  const noted = {
    books: [book(B1, 'Alpha', { internalNote: 'rebind in 2027' })],
    copies: [copy(C1, B1, 'B000001', { internalNote: 'cover torn' })],
  };
  const fileRow = row(2, { id: B1, title: 'Alpha', author: 'Author', page_count: '100', book_note: 'rebind in 2028', copy_id: C1, copy_code: 'B000001', copy_status: 'available', copy_note: '' });

  it('shows current vs new for the book note and the copy note, for a caller who may see notes', () => {
    const [plan] = planImport([fileRow], noted, { notes: true });
    expect(plan.fields.find((f) => f.field === 'book_note')).toMatchObject({ current: 'rebind in 2027', incoming: 'rebind in 2028', differs: true });
    expect(plan.copies[0].fields.find((f) => f.field === 'copy_note')).toMatchObject({ current: 'cover torn', incoming: null, differs: true });
    expect(plan.action).toBe('update');
  });

  it('a caller without notes permission neither sees, compares nor changes notes', () => {
    const [plan] = planImport([fileRow], { books: noted.books.map(({ internalNote: _n, ...b }) => b), copies: noted.copies.map(({ internalNote: _n, ...c }) => c) }, { notes: false });
    expect(plan.fields.map((f) => f.field)).not.toContain('book_note');
    expect(plan.copies[0].fields.map((f) => f.field)).not.toContain('copy_note');
    expect(plan.action).toBe('unchanged');
    expect(plan.copies[0].action).toBe('unchanged');
    expect(JSON.stringify(plan)).not.toContain('rebind');
    expect(JSON.stringify(plan)).not.toContain('cover torn');
  });

  it('parses the notes into the values written', () => {
    expect(toBookValues({ title: 'A', book_note: '  keep  ' })).toEqual({ values: expect.objectContaining({ internalNote: 'keep' }) });
    expect(toCopyValues({ copy_note: '' }, 'available')).toEqual({ values: expect.objectContaining({ internalNote: null }) });
  });
});

describe('value parsing', () => {
  it('requires a title and a whole page count of at least 1', () => {
    expect(toBookValues({ title: '  ' })).toEqual({ error: 'title is required' });
    expect(toBookValues({ title: 'A', page_count: '0' })).toHaveProperty('error');
    expect(toBookValues({ title: 'A', page_count: '120', description: 'd' })).toEqual({
      values: { title: 'A', author: null, publisher: null, category: null, readingLevel: null, language: null, description: 'd', pageCount: 120, internalNote: null },
    });
  });

  it('parses copy status and date', () => {
    expect(toCopyValues({}, 'available')).toEqual({ values: { code: null, status: 'available', condition: null, location: null, acquisitionDate: null, internalNote: null } });
    expect(toCopyValues({ copy_status: 'Lost', copy_acquisition_date: '2026-02-03' }, 'available')).toEqual({ values: expect.objectContaining({ status: 'lost', acquisitionDate: '2026-02-03' }) });
    expect(toCopyValues({ copy_status: 'x' }, 'available')).toHaveProperty('error');
    expect(toCopyValues({ copy_acquisition_date: '2026-13-40' }, 'available')).toHaveProperty('error');
  });

  it('recognises ids', () => {
    expect(isUuid(B1)).toBe(true);
    expect(isUuid('nope')).toBe(false);
  });
});
