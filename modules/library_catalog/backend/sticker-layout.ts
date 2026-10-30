/**
 * Sticker layout rules (LIBRARY_CATALOG-D33). Framework-free and shared: the server validates a saved layout with
 * `normalizeLayout`, and the designer / print pages use the same geometry (`computeGrid`, `cellOrigin`),
 * text shortening (`shorten`) and paging (`paginate`), so what the preview shows is exactly what prints.
 *
 * All sizes are millimetres. A layout describes the PAPER (page size and margins), the sticker cell (size and the
 * gap between cells — the grid of columns/rows is derived from these) and the ELEMENTS placed inside one sticker
 * (QR code, barcode, text taken from a book/copy field, a fixed text, or the configurable header text).
 */
export const ELEMENT_KINDS = ['qr', 'barcode', 'text'] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** Where a text/QR/barcode element takes its value from. `static` is the element's own fixed text. */
export const DATA_SOURCES = ['code', 'title', 'author', 'publisher', 'category', 'language', 'reading_level', 'location', 'condition', 'acquisition_date', 'header', 'static'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export type StickerData = Partial<Record<Exclude<DataSource, 'static'>, string | null>>;

export interface StickerElement {
  id: string;
  kind: ElementKind;
  /** Text: any source. QR / barcode: the value they encode (normally `code`). */
  source: DataSource;
  staticText: string;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fontSizePt: number;
  bold: boolean;
  align: 'start' | 'center' | 'end';
  /** Text running top-to-bottom (like the old side labels). */
  vertical: boolean;
  /** Longer text is cut after the last whole word that fits and ends with "..."; 0 = no limit. */
  maxChars: number;
}

export interface StickerLayout {
  page: { widthMm: number; heightMm: number; marginTopMm: number; marginRightMm: number; marginBottomMm: number; marginLeftMm: number };
  sticker: { widthMm: number; heightMm: number; gapXMm: number; gapYMm: number; showBorder: boolean };
  elements: StickerElement[];
}

export const PAGE_PRESETS: Record<string, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  A5: { widthMm: 148, heightMm: 210 },
  A3: { widthMm: 297, heightMm: 420 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
};

const el = (id: string, kind: ElementKind, source: DataSource, box: [number, number, number, number], extra: Partial<StickerElement> = {}): StickerElement => ({
  id,
  kind,
  source,
  staticText: '',
  xMm: box[0],
  yMm: box[1],
  wMm: box[2],
  hMm: box[3],
  fontSizePt: 9,
  bold: false,
  align: 'center',
  vertical: false,
  maxChars: 0,
  ...extra,
});

/** Reproduces the original sticker: header text down the start edge, QR + location in the middle, code down the end edge. */
export const DEFAULT_LAYOUT: StickerLayout = {
  page: { widthMm: 210, heightMm: 297, marginTopMm: 8, marginRightMm: 8, marginBottomMm: 8, marginLeftMm: 8 },
  sticker: { widthMm: 62, heightMm: 40, gapXMm: 3, gapYMm: 3, showBorder: true },
  elements: [
    el('header', 'text', 'header', [2, 2, 7, 36], { fontSizePt: 8, bold: true, vertical: true }),
    el('qr', 'qr', 'code', [11, 3, 29, 29]),
    el('location', 'text', 'location', [10, 33, 31, 5], { fontSizePt: 8, maxChars: 24 }),
    el('code', 'text', 'code', [45, 2, 15, 36], { fontSizePt: 12, bold: true, vertical: true }),
  ],
};

const num = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
};

const str = (value: unknown, max: number, fallback = ''): string => (typeof value === 'string' ? value.slice(0, max) : fallback);

/** Turns anything a client sent into a safe, complete layout: unknown values fall back to the defaults, numbers are clamped. */
export function normalizeLayout(raw: unknown): StickerLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown> | unknown[] | undefined>;
  const page = (r.page ?? {}) as Record<string, unknown>;
  const sticker = (r.sticker ?? {}) as Record<string, unknown>;
  const d = DEFAULT_LAYOUT;
  const elementsRaw = Array.isArray(r.elements) ? (r.elements as unknown[]).slice(0, 30) : null;
  const seen = new Set<string>();
  const elements = (elementsRaw ?? d.elements).map((item, index) => {
    const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    let id = str(e.id, 40).replace(/[^a-zA-Z0-9_-]/g, '') || `e${index + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const kind = (ELEMENT_KINDS as readonly string[]).includes(e.kind as string) ? (e.kind as ElementKind) : 'text';
    const source = (DATA_SOURCES as readonly string[]).includes(e.source as string) ? (e.source as DataSource) : kind === 'text' ? 'static' : 'code';
    const align = e.align === 'start' || e.align === 'end' ? e.align : 'center';
    return {
      id,
      kind,
      source,
      staticText: str(e.staticText, 200),
      xMm: num(e.xMm, 0, 500, 0),
      yMm: num(e.yMm, 0, 500, 0),
      wMm: num(e.wMm, 2, 500, 20),
      hMm: num(e.hMm, 2, 500, 10),
      fontSizePt: num(e.fontSizePt, 4, 72, 9),
      bold: e.bold === true,
      align,
      vertical: e.vertical === true,
      maxChars: Math.round(num(e.maxChars, 0, 500, 0)),
    } as StickerElement;
  });
  return {
    page: {
      widthMm: num(page.widthMm, 50, 1000, d.page.widthMm),
      heightMm: num(page.heightMm, 50, 1000, d.page.heightMm),
      marginTopMm: num(page.marginTopMm, 0, 100, d.page.marginTopMm),
      marginRightMm: num(page.marginRightMm, 0, 100, d.page.marginRightMm),
      marginBottomMm: num(page.marginBottomMm, 0, 100, d.page.marginBottomMm),
      marginLeftMm: num(page.marginLeftMm, 0, 100, d.page.marginLeftMm),
    },
    sticker: {
      widthMm: num(sticker.widthMm, 5, 300, d.sticker.widthMm),
      heightMm: num(sticker.heightMm, 5, 300, d.sticker.heightMm),
      gapXMm: num(sticker.gapXMm, 0, 50, d.sticker.gapXMm),
      gapYMm: num(sticker.gapYMm, 0, 50, d.sticker.gapYMm),
      showBorder: sticker.showBorder === undefined ? d.sticker.showBorder : sticker.showBorder === true,
    },
    elements,
  };
}

export interface Grid {
  columns: number;
  rows: number;
  perPage: number;
  /** Elements/stickers that stick out of the sticker or the page, as readable warnings (empty = all good). */
  problems: ('sticker_wider_than_page' | 'sticker_taller_than_page' | 'element_outside_sticker')[];
}

/** How many stickers fit in a row and a column of the usable page area. */
export function computeGrid(layout: StickerLayout): Grid {
  const { page, sticker } = layout;
  const usableW = page.widthMm - page.marginLeftMm - page.marginRightMm;
  const usableH = page.heightMm - page.marginTopMm - page.marginBottomMm;
  // Floating-point slack: 3 stickers + 2 gaps that exactly fill the width must still count as 3.
  const fit = (usable: number, size: number, gap: number) => Math.max(0, Math.floor((usable + gap) / (size + gap) + 1e-9));
  const columns = fit(usableW, sticker.widthMm, sticker.gapXMm);
  const rows = fit(usableH, sticker.heightMm, sticker.gapYMm);
  const problems: Grid['problems'] = [];
  if (columns < 1) problems.push('sticker_wider_than_page');
  if (rows < 1) problems.push('sticker_taller_than_page');
  if (layout.elements.some((e) => e.xMm + e.wMm > sticker.widthMm + 0.01 || e.yMm + e.hMm > sticker.heightMm + 0.01)) problems.push('element_outside_sticker');
  return { columns, rows, perPage: columns * rows, problems };
}

/** Top-left corner of the cell at 0-based row/column, on the page. */
export function cellOrigin(layout: StickerLayout, row: number, column: number): { xMm: number; yMm: number } {
  return {
    xMm: layout.page.marginLeftMm + column * (layout.sticker.widthMm + layout.sticker.gapXMm),
    yMm: layout.page.marginTopMm + row * (layout.sticker.heightMm + layout.sticker.gapYMm),
  };
}

/**
 * Cuts text that is longer than `max` after the last whole word that still fits and ends it with "...", so the
 * result is never longer than `max`. A single very long word is cut hard. `max` <= 0 means no limit.
 */
export function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (max <= 0 || clean.length <= max) return clean;
  if (max <= 3) return clean.slice(0, max);
  const room = clean.slice(0, max - 3);
  // The cut is clean when the next character is a space; otherwise step back to the previous word end.
  const cleanCut = clean[max - 3] === ' ';
  const lastSpace = room.lastIndexOf(' ');
  const kept = cleanCut || lastSpace <= 0 ? room : room.slice(0, lastSpace);
  return `${kept.trimEnd()}...`;
}

/** The text an element shows for one copy, already shortened to its `maxChars`. */
export function elementText(element: StickerElement, data: StickerData): string {
  const raw = element.source === 'static' ? element.staticText : (data[element.source] ?? '');
  return element.kind === 'text' ? shorten(String(raw), element.maxChars) : String(raw);
}

/** Sample values for the designer's dummy sticker. */
export const SAMPLE_DATA: StickerData = {
  code: 'B000123',
  title: 'The Little Prince and the Fox of the Desert',
  author: 'Antoine de Saint-Exupéry',
  publisher: 'Library Press',
  category: 'Story',
  language: 'English',
  reading_level: 'Level 3',
  location: 'Shelf A-2',
  condition: 'Good',
  acquisition_date: '2026-01-15',
  header: 'My Library',
};

/**
 * Splits stickers over sheets. Cells are filled left to right, top to bottom, starting at the 0-based `startCell`
 * of the FIRST sheet (cells before it stay empty, for a sheet that is already partly used); every later sheet starts
 * at its first cell. `null` = an empty cell.
 */
export function paginate<T>(items: readonly T[], perPage: number, startCell = 0): (T | null)[][] {
  if (perPage < 1) return [];
  const start = Math.min(Math.max(0, Math.floor(startCell)), perPage - 1);
  const pages: (T | null)[][] = [];
  let index = 0;
  let first = true;
  while (index < items.length || (first && items.length === 0)) {
    const page: (T | null)[] = new Array(perPage).fill(null);
    for (let cell = first ? start : 0; cell < perPage && index < items.length; cell += 1) {
      page[cell] = items[index];
      index += 1;
    }
    pages.push(page);
    first = false;
    if (items.length === 0) break;
  }
  return pages;
}
