import { Box } from '@mui/material';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
      let d = '';
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
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
    body = (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: element.align === 'start' ? 'flex-start' : element.align === 'end' ? 'flex-end' : 'center',
          textAlign: element.align === 'start' ? 'start' : element.align === 'end' ? 'end' : 'center',
          fontSize: fontLen(unit, element.fontSizePt),
          fontWeight: element.bold ? 700 : 400,
          lineHeight: 1.15,
          wordBreak: 'break-word',
          writingMode: element.vertical ? 'vertical-rl' : undefined,
          color: '#000',
        }}
      >
        {value}
      </div>
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
 * Prints sheets at the exact paper size with no browser margins, one `.sticker-page` per sheet, never splitting a
 * sticker across pages. Everything else on the screen is hidden while printing. Mount it only while printing.
 */
export function StickerPrintPortal({ layout, pages, onDone }: { layout: StickerLayout; pages: (StickerData | null)[][]; onDone: () => void }) {
  const host = useMemo(() => {
    const node = document.createElement('div');
    node.id = 'sticker-print-root';
    return node;
  }, []);

  useEffect(() => {
    document.body.appendChild(host);
    document.body.classList.add('printing-stickers');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-stickers');
      host.remove();
      onDone();
    };
    window.addEventListener('afterprint', finish);
    // Let React paint the sheets first; print() blocks until the dialog closes in most browsers.
    const timer = window.setTimeout(() => {
      window.print();
      // Browsers that don't block (some mobile ones) still end up here; afterprint cleans up when it fires.
      window.setTimeout(finish, 1500);
    }, 150);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-stickers');
      host.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount; the sheets are fixed for this print job.
  }, []);

  return createPortal(
    <>
      <style>{`
        @page { size: ${layout.page.widthMm}mm ${layout.page.heightMm}mm; margin: 0; }
        #sticker-print-root { display: none; }
        @media print {
          body.printing-stickers > *:not(#sticker-print-root) { display: none !important; }
          body.printing-stickers { background: #fff !important; margin: 0 !important; }
          #sticker-print-root { display: block !important; }
          #sticker-print-root .sticker-page { break-after: page; page-break-after: always; }
          #sticker-print-root .sticker-page:last-child { break-after: auto; page-break-after: auto; }
          #sticker-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      {pages.map((cells, index) => (
        <PageSheet key={index} layout={layout} cells={cells} unit={{ kind: 'mm' }} showEmptyCells={false} />
      ))}
    </>,
    host,
  );
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
