import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import catalogEn from '../../locales/en.json';
import { DEFAULT_LAYOUT, SAMPLE_DATA, computeGrid, paginate } from '../../backend/sticker-layout.ts';

const api = vi.hoisted(() => ({ getStickerLayout: vi.fn(), getStickerSettings: vi.fn(), updateStickerLayout: vi.fn() }));
vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), libraryCatalogApi: api }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ children }: { children: unknown }) => children,
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
}));

import { PrintStickerDialog } from '../../frontend/pages/PrintStickerDialog';
import { StickerDesignerPage } from '../../frontend/pages/StickerDesignerPage';
import { BarcodeSvg, PageSheet, QrSvg, stickersDocument } from '../../frontend/stickers';

const book = { id: 'b1', title: 'Hobbit', author: 'Tolkien', publisher: null, category: null, language: null, readingLevel: null } as never;
const copy = { id: 'c1', bookId: 'b1', qrCode: 'B000042', status: 'available', condition: null, location: 'Shelf 1', acquisitionDate: null } as never;

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', catalogEn, true, true);
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  vi.clearAllMocks();
  api.getStickerLayout.mockResolvedValue(DEFAULT_LAYOUT);
  api.getStickerSettings.mockResolvedValue({ headerText: 'My School' });
  api.updateStickerLayout.mockImplementation(async (layout: unknown) => layout);
});

describe('sticker building blocks', () => {
  it('draws a QR code and a Code 128 barcode as SVG', () => {
    const qr = render(<QrSvg value="B000042" />);
    expect(qr.container.querySelector('svg path')?.getAttribute('d')).toMatch(/^M/);
    const bar = render(<BarcodeSvg value="B000042" />);
    expect(bar.container.querySelectorAll('svg rect').length).toBeGreaterThan(5);
  });

  it('a sheet has exactly one cell per grid position; empty cells are selectable', () => {
    const grid = computeGrid(DEFAULT_LAYOUT);
    const cells = paginate([SAMPLE_DATA], grid.perPage, 4)[0];
    const onSelect = vi.fn();
    const { container } = render(<PageSheet layout={DEFAULT_LAYOUT} cells={cells} unit={{ kind: 'px', pxPerMm: 2 }} onSelectCell={onSelect} />);
    expect(container.querySelectorAll('[data-cell]').length).toBe(grid.perPage);
    expect(container.querySelectorAll('.sticker-cell-empty').length).toBe(grid.perPage - 1);
    fireEvent.click(container.querySelector('[data-cell="0"]')!);
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});

describe('stickersDocument (what the print window contains)', () => {
  const grid = computeGrid(DEFAULT_LAYOUT);
  const items = Array.from({ length: grid.perPage + 2 }, (_, i) => ({ ...SAMPLE_DATA, code: `B${String(i + 1).padStart(6, '0')}` }));
  const html = stickersDocument(DEFAULT_LAYOUT, paginate(items, grid.perPage, 4), { title: 'Stickers', print: 'Print', hint: 'Use 100%' });

  it('is a standalone page with exact paper size, no margins, and one block per sheet', () => {
    expect(html).toContain('@page { size: 210mm 297mm; margin: 0; }');
    expect((html.match(/class="sticker-page"/g) ?? []).length).toBe(2);
    expect(html).toContain('break-after: page');
    expect(html).toContain('Use 100%');
  });

  it('contains only the stickers (no app screen), with empty cells left out and vertical text rotated, not writing-mode', () => {
    expect((html.match(/B0000\d\d/g) ?? []).length).toBeGreaterThanOrEqual(items.length);
    expect(html).not.toContain('sticker-cell-empty');
    expect(html).not.toContain('writing-mode');
    expect(html).toContain('rotate(90deg)');
  });

  it('escapes the labels it is given', () => {
    expect(stickersDocument(DEFAULT_LAYOUT, [[SAMPLE_DATA]], { title: '<b>x</b>', print: 'P', hint: 'h' })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('PrintStickerDialog', () => {
  it('puts the sticker in the chosen row/column and leaves every other cell empty', async () => {
    const { container } = render(<PrintStickerDialog open book={book} copy={copy} onClose={vi.fn()} />);
    await screen.findByText(/3 columns × 6 rows/);
    fireEvent.change(screen.getByLabelText('Row'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: '2' } });
    const filled = Array.from(container.ownerDocument.querySelectorAll('[data-cell]')).filter((n) => !n.classList.contains('sticker-cell-empty'));
    expect(filled).toHaveLength(1);
    expect(filled[0].getAttribute('data-cell')).toBe(String((3 - 1) * 3 + (2 - 1)));
    expect(filled[0].textContent).toContain('B000042');
    expect(filled[0].textContent).toContain('My School');
  });
});

describe('StickerDesignerPage', () => {
  it('shows how many stickers fit, shortens text at the max length, and saves the edited layout', async () => {
    render(<StickerDesignerPage />);
    await screen.findByText(/3 columns × 6 rows = 18 stickers per sheet/);

    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    // The new text element shows the book title; limit it to 13 characters.
    fireEvent.change(screen.getByLabelText('Max characters'), { target: { value: '13' } });
    await waitFor(() => expect(screen.getAllByText('The Little...').length).toBeGreaterThan(0));

    // A wider sticker leaves room for fewer columns.
    fireEvent.change(screen.getAllByLabelText('Width (mm)')[1], { target: { value: '100' } });
    await screen.findByText(/1 columns × 6 rows = 6 stickers per sheet/);

    fireEvent.click(screen.getByRole('button', { name: 'core.common.save' }));
    await waitFor(() => expect(api.updateStickerLayout).toHaveBeenCalled());
    const saved = api.updateStickerLayout.mock.calls[0][0];
    expect(saved.sticker.widthMm).toBe(100);
    expect(saved.elements.at(-1)).toMatchObject({ kind: 'text', source: 'title', maxChars: 13 });
  });
});
