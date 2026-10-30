import { Box } from '@mui/material';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  cellOrigin,
  computeGrid,
  elementText,
  type StickerData,
  type StickerElement,
  type StickerLayout,
} from '../backend/sticker-layout.ts';

/** Millimetres → CSS length. Print uses real `mm`; the on-screen previews use pixels at `pxPerMm`. */
export type Unit = { kind: 'mm' } | { kind: 'px'; pxPerMm: number };
const MM_PER_PT = 25.4 / 72;
const len = (unit: Unit, mm: number): string => (unit.kind === 'mm' ? `${mm}mm` : `${mm * unit.pxPerMm}px`);
const fontLen = (unit: Unit, pt: number): string => (unit.kind === 'mm' ? `${pt}pt` : `${pt * MM_PER_PT * unit.pxPerMm}px`);

/** A QR code drawn synchronously as SVG (so it is ready the moment the print dialog opens). */
export function QrSvg({ value }: { value: string }) {
  const paths = useMemo(() => {
    try {
      const qr = QRCode.create(value || ' ', { errorCorrectionLevel: 'M' });
      const size = qr.modules.size;
      const data = qr.modules.data;
      // One rectangle per horizontal run of dark modules (about a third of the markup of one per module): a job of
      // hundreds of stickers is otherwise a document large enough to freeze a phone.
      let d = '';
      for (let y = 0; y < size; y += 1) {
        let x = 0;
        while (x < size) {
          if (!data[y * size + x]) {
            x += 1;
            continue;
          }
          let run = 1;
          while (x + run < size && data[y * size + x + run]) run += 1;
          d += `M${x} ${y}h${run}v1h-${run}z`;
          x += run;
        }
      }
      return { size, d };
    } catch {
      return null;
    }
  }, [value]);
  if (!paths) return null;
  const quiet = 1;
  return (
    <svg viewBox={`${-quiet} ${-quiet} ${paths.size + quiet * 2} ${paths.size + quiet * 2}`} width="100%" height="100%" shapeRendering="crispEdges" role="img" aria-label={value}>
      <rect x={-quiet} y={-quiet} width={paths.size + quiet * 2} height={paths.size + quiet * 2} fill="#fff" />
      <path d={paths.d} fill="#000" />
    </svg>
  );
}

/** A Code 128 barcode, stretched to its box. */
export function BarcodeSvg({ value }: { value: string }) {
  const markup = useMemo(() => {
    if (!value) return null;
    try {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(svg, value, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 60 });
      const width = svg.getAttribute('width') ?? '100';
      const height = svg.getAttribute('height') ?? '60';
      return { inner: svg.innerHTML, width: parseFloat(width), height: parseFloat(height) };
    } catch {
      return null;
    }
  }, [value]);
  if (!markup) return null;
  return (
    <svg viewBox={`0 0 ${markup.width} ${markup.height}`} width="100%" height="100%" preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={value}>
      <rect width={markup.width} height={markup.height} fill="#fff" />
      <g dangerouslySetInnerHTML={{ __html: markup.inner }} />
    </svg>
  );
}

function ElementView({ element, data, unit, selected, onPointerDown }: { element: StickerElement; data: StickerData; unit: Unit; selected?: boolean; onPointerDown?: (e: React.PointerEvent) => void }) {
  const value = elementText(element, data);
  const style: CSSProperties = {
    position: 'absolute',
    left: len(unit, element.xMm),
    top: len(unit, element.yMm),
    width: len(unit, element.wMm),
    height: len(unit, element.hMm),
    boxSizing: 'border-box',
    overflow: 'hidden',
    outline: selected ? '1.5px dashed #1976d2' : undefined,
    cursor: onPointerDown ? 'move' : undefined,
    touchAction: onPointerDown ? 'none' : undefined,
  };
  let body: ReactNode = null;
  if (element.kind === 'qr') body = <QrSvg value={value} />;
  else if (element.kind === 'barcode') body = <BarcodeSvg value={value} />;
  else {
    const align = element.align === 'start' ? 'flex-start' : element.align === 'end' ? 'flex-end' : 'center';
    const textStyle: CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: align,
      textAlign: element.align === 'start' ? 'start' : element.align === 'end' ? 'end' : 'center',
      fontSize: fontLen(unit, element.fontSizePt),
      fontWeight: element.bold ? 700 : 400,
      lineHeight: 1.15,
      wordBreak: 'break-word',
      color: '#000',
    };
    // Vertical text is the box turned 90 degrees (reads top to bottom), not `writing-mode`: that is dropped by the
    // PDF renderer and by several mobile print engines.
    body = element.vertical ? (
      <div
        style={{
          ...textStyle,
          position: 'absolute',
          left: 0,
          top: 0,
          width: len(unit, element.hMm),
          height: len(unit, element.wMm),
          transformOrigin: 'top left',
          transform: `translateX(${len(unit, element.wMm)}) rotate(90deg)`,
        }}
      >
        {value}
      </div>
    ) : (
      <div style={{ ...textStyle, width: '100%', height: '100%' }}>{value}</div>
    );
  }
  return (
    <div style={style} onPointerDown={onPointerDown} data-element-id={element.id}>
      {body}
    </div>
  );
}

/** One sticker: its elements laid out inside the sticker box. */
export function StickerView({
  layout,
  data,
  unit,
  selectedId,
  onElementPointerDown,
}: {
  layout: StickerLayout;
  data: StickerData;
  unit: Unit;
  selectedId?: string | null;
  onElementPointerDown?: (id: string, e: React.PointerEvent) => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: len(unit, layout.sticker.widthMm),
        height: len(unit, layout.sticker.heightMm),
        boxSizing: 'border-box',
        border: layout.sticker.showBorder ? '1px solid #000' : undefined,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {layout.elements.map((element) => (
        <ElementView
          key={element.id}
          element={element}
          data={data}
          unit={unit}
          selected={selectedId === element.id}
          onPointerDown={onElementPointerDown ? (e) => onElementPointerDown(element.id, e) : undefined}
        />
      ))}
    </div>
  );
}

/**
 * The paper with its grid of cells. `cells[i]` is the data of cell i (row-major), or null for an empty cell.
 * With `onSelectCell` every cell is clickable (used to choose where a sticker goes); `selectedCell` is highlighted.
 * Cells are positioned absolutely at exact millimetre coordinates, so nothing can wrap or split across pages.
 */
export function PageSheet({
  layout,
  cells,
  unit,
  selectedCell,
  onSelectCell,
  showEmptyCells = true,
}: {
  layout: StickerLayout;
  cells: (StickerData | null)[];
  unit: Unit;
  selectedCell?: number | null;
  onSelectCell?: (index: number) => void;
  showEmptyCells?: boolean;
}) {
  const grid = computeGrid(layout);
  return (
    <div
      className="sticker-page"
      style={{ position: 'relative', width: len(unit, layout.page.widthMm), height: len(unit, layout.page.heightMm), background: '#fff', overflow: 'hidden', boxSizing: 'border-box' }}
    >
      {Array.from({ length: grid.perPage }, (_, index) => {
        const row = Math.floor(index / grid.columns);
        const column = index % grid.columns;
        const origin = cellOrigin(layout, row, column);
        const data = cells[index] ?? null;
        const box: CSSProperties = { position: 'absolute', left: len(unit, origin.xMm), top: len(unit, origin.yMm), width: len(unit, layout.sticker.widthMm), height: len(unit, layout.sticker.heightMm) };
        if (!data) {
          if (!showEmptyCells && !onSelectCell) return null;
          return (
            <div
              key={index}
              style={{ ...box, boxSizing: 'border-box', border: '1px dashed #b0b0b0', cursor: onSelectCell ? 'pointer' : undefined, background: selectedCell === index ? 'rgba(25,118,210,.18)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: unit.kind === 'px' ? Math.max(8, unit.pxPerMm * 3) : undefined }}
              onClick={onSelectCell ? () => onSelectCell(index) : undefined}
              role={onSelectCell ? 'button' : undefined}
              aria-label={onSelectCell ? `r${row + 1} c${column + 1}` : undefined}
              data-cell={index}
              className="sticker-cell-empty"
            >
              {unit.kind === 'px' ? `${row + 1}·${column + 1}` : null}
            </div>
          );
        }
        return (
          <div key={index} style={{ ...box, outline: selectedCell === index ? '2px solid #1976d2' : undefined, cursor: onSelectCell ? 'pointer' : undefined }} onClick={onSelectCell ? () => onSelectCell(index) : undefined} data-cell={index}>
            <StickerView layout={layout} data={data} unit={unit} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Phones and tablets (touch-only devices) print through the PDF instead of the HTML print window: iOS Safari's print
 * preview stays on "Loading Preview…" and the page freezes on the stickers document, while the PDF opens in the
 * system viewer where Share → Print always works.
 */
export const prefersPdfPrinting = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface PrintLabels {
  title: string;
  print: string;
  hint: string;
}

/** A standalone page holding ONLY the sheets, sized to the paper with no browser margins. */
export function stickersDocument(layout: StickerLayout, pages: (StickerData | null)[][], labels: PrintLabels): string {
  const sheets = renderToStaticMarkup(
    <>
      {pages.map((cells, index) => (
        <PageSheet key={index} layout={layout} cells={cells} unit={{ kind: 'mm' }} showEmptyCells={false} />
      ))}
    </>,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(labels.title)}</title><style>
@page { size: ${layout.page.widthMm}mm ${layout.page.heightMm}mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { background: #d9d9d9; font-family: system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; padding: 10px 14px; background: #fff; border-bottom: 1px solid #bbb; }
.bar button { font: inherit; font-weight: 700; padding: 10px 22px; border-radius: 999px; border: 0; background: #1976d2; color: #fff; }
.bar span { color: #555; font-size: 14px; }
.sticker-page { font-family: system-ui, "Segoe UI", Arial, sans-serif; margin: 10px auto; box-shadow: 0 1px 6px rgba(0,0,0,.35); }
@media print {
  body { background: #fff; }
  .bar { display: none; }
  .sticker-page { margin: 0; box-shadow: none; break-after: page; page-break-after: always; }
  .sticker-page:last-child { break-after: auto; page-break-after: auto; }
}
</style></head><body><div class="bar"><button type="button" onclick="window.print()">${escapeHtml(labels.print)}</button><span>${escapeHtml(labels.hint)}</span></div>${sheets}<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 500); });</script></body></html>`;
}

/**
 * Prints the sheets from their own window that contains nothing else, so phones and desktops print exactly the
 * stickers (printing the app page itself printed the whole screen on phones). MUST be called straight from a click
 * (the window is opened before anything async, or pop-up blockers refuse it). Returns false if the browser blocked it.
 */
export function printStickers(layout: StickerLayout, pages: (StickerData | null)[][], labels: PrintLabels): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(stickersDocument(layout, pages, labels));
  win.document.close();
  return true;
}

/** Saves the sheets as a PDF at the exact paper size (works everywhere, incl. phones; share/print it from there). */
export async function downloadStickersPdf(layout: StickerLayout, pages: (StickerData | null)[][], fileName = 'stickers.pdf'): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const pxPerMm = 96 / 25.4;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        <>
          {pages.map((cells, index) => (
            <PageSheet key={index} layout={layout} cells={cells} unit={{ kind: 'px', pxPerMm }} showEmptyCells={false} />
          ))}
        </>,
      ),
    );
    if (document.fonts?.ready) await document.fonts.ready;
    const { widthMm, heightMm } = layout.page;
    const pdf = new jsPDF({ unit: 'mm', format: [widthMm, heightMm], orientation: widthMm > heightMm ? 'landscape' : 'portrait', compress: true });
    const sheets = Array.from(host.querySelectorAll<HTMLElement>('.sticker-page'));
    for (let i = 0; i < sheets.length; i += 1) {
      // 2.5x of 96 dpi = 240 dpi: sharp QR codes while staying inside phone canvas-size limits.
      const canvas = await html2canvas(sheets[i], { scale: 2.5, backgroundColor: '#ffffff', logging: false });
      if (i > 0) pdf.addPage([widthMm, heightMm], widthMm > heightMm ? 'landscape' : 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, widthMm, heightMm);
    }
    pdf.save(fileName);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Small on-screen picture of one sheet that fits `maxWidthPx`; clickable cells when `onSelectCell` is given. */
export function PageGridPreview({
  layout,
  cells,
  maxWidthPx = 360,
  selectedCell,
  onSelectCell,
}: {
  layout: StickerLayout;
  cells: (StickerData | null)[];
  maxWidthPx?: number;
  selectedCell?: number | null;
  onSelectCell?: (index: number) => void;
}) {
  const pxPerMm = maxWidthPx / layout.page.widthMm;
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', boxShadow: 2, display: 'inline-block', maxWidth: '100%', overflow: 'auto', direction: 'ltr' }}>
      <PageSheet layout={layout} cells={cells} unit={{ kind: 'px', pxPerMm }} selectedCell={selectedCell} onSelectCell={onSelectCell} />
    </Box>
  );
}
