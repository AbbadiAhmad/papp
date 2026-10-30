import { describe, expect, it } from '@jest/globals';
import { DEFAULT_LAYOUT, cellOrigin, computeGrid, elementText, normalizeLayout, paginate, shorten, type StickerElement } from '../../backend/sticker-layout';

describe('shorten', () => {
  it('leaves text that fits, and treats 0 as no limit', () => {
    expect(shorten('A short title', 20)).toBe('A short title');
    expect(shorten('anything at all goes here', 0)).toBe('anything at all goes here');
  });

  it('cuts after the last whole word that fits and adds "..."', () => {
    const out = shorten('The Little Prince and the Fox', 20);
    expect(out).toBe('The Little Prince...');
    expect(out.length).toBeLessThanOrEqual(20);
    // The cut lands exactly on a word end.
    expect(shorten('one two three four', 11)).toBe('one two...');
  });

  it('keeps the next word out when the cut falls inside it', () => {
    expect(shorten('alpha beta gamma', 13)).toBe('alpha beta...'); // "gamma" does not fit whole
    expect(shorten('alpha beta gamma', 12)).toBe('alpha...');
  });

  it('hard-cuts one very long word and never exceeds the limit', () => {
    const out = shorten('Supercalifragilisticexpialidocious', 10);
    expect(out).toBe('Superca...');
    expect(out.length).toBe(10);
    expect(shorten('abcdef', 3)).toBe('abc');
  });

  it('collapses runs of whitespace', () => {
    expect(shorten('  a   b \n c ', 50)).toBe('a b c');
  });
});

describe('grid', () => {
  it('the default layout fits 3 columns x 6 rows on A4 (no overflowing row)', () => {
    const grid = computeGrid(DEFAULT_LAYOUT);
    expect(grid).toMatchObject({ columns: 3, rows: 6, perPage: 18 });
    expect(grid.problems).toEqual([]);
    // The last row ends inside the printable area, so it can never be split over two pages.
    const last = cellOrigin(DEFAULT_LAYOUT, 5, 2);
    expect(last.yMm + DEFAULT_LAYOUT.sticker.heightMm).toBeLessThanOrEqual(DEFAULT_LAYOUT.page.heightMm - DEFAULT_LAYOUT.page.marginBottomMm);
    expect(last.xMm + DEFAULT_LAYOUT.sticker.widthMm).toBeLessThanOrEqual(DEFAULT_LAYOUT.page.widthMm - DEFAULT_LAYOUT.page.marginRightMm);
  });

  it('counts an exact fit and reports stickers that do not fit or elements that stick out', () => {
    const exact = { ...DEFAULT_LAYOUT, page: { ...DEFAULT_LAYOUT.page, widthMm: 192, marginLeftMm: 0, marginRightMm: 0 } };
    expect(computeGrid(exact).columns).toBe(3); // 3 x 62 + 2 x 3 = 192
    const big = { ...DEFAULT_LAYOUT, sticker: { ...DEFAULT_LAYOUT.sticker, widthMm: 300 } };
    expect(computeGrid(big)).toMatchObject({ columns: 0, perPage: 0 });
    expect(computeGrid(big).problems).toContain('sticker_wider_than_page');
    const sticks = { ...DEFAULT_LAYOUT, elements: [{ ...DEFAULT_LAYOUT.elements[0], xMm: 60 }] };
    expect(computeGrid(sticks).problems).toContain('element_outside_sticker');
  });

  it('places cells left to right, top to bottom', () => {
    expect(cellOrigin(DEFAULT_LAYOUT, 0, 0)).toEqual({ xMm: 8, yMm: 8 });
    expect(cellOrigin(DEFAULT_LAYOUT, 1, 2)).toEqual({ xMm: 8 + 2 * 65, yMm: 8 + 43 });
  });
});

describe('paginate', () => {
  it('starts at the chosen cell of the first sheet and every later sheet at its first cell', () => {
    const pages = paginate([1, 2, 3, 4, 5], 4, 2);
    expect(pages).toEqual([
      [null, null, 1, 2],
      [3, 4, 5, null],
    ]);
  });

  it('one sticker in row 3 column 2 leaves every other cell empty', () => {
    const perPage = 18; // 3 columns x 6 rows
    const cell = (3 - 1) * 3 + (2 - 1);
    const [page] = paginate(['x'], perPage, cell);
    expect(page.filter(Boolean)).toEqual(['x']);
    expect(page[cell]).toBe('x');
    expect(page).toHaveLength(perPage);
  });

  it('no stickers still gives one empty sheet; a start beyond the sheet is clamped', () => {
    expect(paginate([], 4)).toEqual([[null, null, null, null]]);
    expect(paginate(['a'], 4, 99)[0][3]).toBe('a');
  });
});

describe('normalizeLayout', () => {
  it('falls back to the default for garbage and clamps numbers', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    const out = normalizeLayout({ page: { widthMm: 5, heightMm: 'abc', marginTopMm: -4 }, sticker: { widthMm: 9999 }, elements: [{ kind: 'qr', wMm: 0, fontSizePt: 500 }] });
    expect(out.page.widthMm).toBe(50);
    expect(out.page.heightMm).toBe(297);
    expect(out.page.marginTopMm).toBe(0);
    expect(out.sticker.widthMm).toBe(300);
    expect(out.elements[0]).toMatchObject({ kind: 'qr', wMm: 2, fontSizePt: 72 });
  });

  it('keeps ids unique and drops unknown kinds/sources to safe values', () => {
    const out = normalizeLayout({ elements: [{ id: 'a', kind: 'x', source: 'nope' }, { id: 'a', kind: 'text', source: 'title' }] });
    expect(new Set(out.elements.map((e) => e.id)).size).toBe(2);
    expect(out.elements[0]).toMatchObject({ kind: 'text', source: 'static' });
  });

  it('is idempotent', () => {
    expect(normalizeLayout(normalizeLayout(DEFAULT_LAYOUT))).toEqual(normalizeLayout(DEFAULT_LAYOUT));
  });
});

describe('elementText', () => {
  const text = (extra: Partial<StickerElement>): StickerElement => ({ ...DEFAULT_LAYOUT.elements[2], source: 'title', maxChars: 0, ...extra });
  it('shortens text placeholders to their max length but never the value a QR/barcode encodes', () => {
    const data = { title: 'A very long book title indeed', code: 'B000123' };
    expect(elementText(text({ maxChars: 14 }), data)).toBe('A very long...');
    expect(elementText({ ...text({ maxChars: 3 }), kind: 'qr', source: 'code' }, data)).toBe('B000123');
    expect(elementText(text({ source: 'author' }), data)).toBe('');
    expect(elementText(text({ source: 'static', staticText: 'Hello' }), data)).toBe('Hello');
  });
});
