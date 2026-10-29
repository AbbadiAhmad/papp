import { describe, expect, it } from '@jest/globals';
import { changedFields, isUuid, toBookValues } from '../../backend/books-import-rules';

describe('books import rules', () => {
  it('requires a title and a whole page count of at least 1', () => {
    expect(toBookValues({ title: '  ' })).toEqual({ error: 'title is required' });
    expect(toBookValues({ title: 'A', page_count: '0' })).toHaveProperty('error');
    expect(toBookValues({ title: 'A', page_count: '1.5' })).toHaveProperty('error');
    expect(toBookValues({ title: 'A', page_count: '120' })).toEqual({
      values: { title: 'A', author: null, publisher: null, category: null, readingLevel: null, language: null, pageCount: 120 },
    });
  });

  it('treats blank optional cells as cleared', () => {
    const parsed = toBookValues({ title: 'A', author: ' ', category: 'Story' });
    expect(parsed).toEqual({ values: expect.objectContaining({ author: null, category: 'Story' }) });
  });

  it('reports only the fields that differ', () => {
    const current = { title: 'A', author: 'X', publisher: null, category: null, readingLevel: null, language: null, pageCount: 10 };
    expect(changedFields(current, { ...current })).toEqual([]);
    expect(changedFields(current, { ...current, author: null, pageCount: 20 })).toEqual(['author', 'pageCount']);
  });

  it('recognises book ids', () => {
    expect(isUuid('3f2b8c1e-9a4d-4b7e-8c21-0d5e6f7a8b9c')).toBe(true);
    expect(isUuid('not-an-id')).toBe(false);
  });
});
