import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import PrintIcon from '@mui/icons-material/Print';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LAYOUT, computeGrid, paginate, type StickerData } from '../../backend/sticker-layout.ts';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { libraryCatalogApi, type LibraryBook, type LibraryBookCopy, type StickerLayout } from '../api';
import { PageGridPreview, downloadStickersPdf, prefersPdfPrinting, printStickers } from '../stickers';

/**
 * Print ONE copy's sticker into a chosen cell of the sticker sheet (LIBRARY_CATALOG-D33): pick the row/column (or click
 * the cell), every other cell stays empty — for a sheet whose stickers are already cut, where the librarian prints on
 * an unused one.
 */
export function PrintStickerDialog({ open, book, copy, onClose }: { open: boolean; book: LibraryBook; copy: LibraryBookCopy | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<StickerLayout>(DEFAULT_LAYOUT);
  const [headerText, setHeaderText] = useState('');
  const [cell, setCell] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const phonePrinting = prefersPdfPrinting();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCell(0);
    libraryCatalogApi.getStickerLayout().then(setLayout).catch(() => setError(t('library_catalog.designer.load_failed')));
    libraryCatalogApi.getStickerSettings().then((s) => setHeaderText(s.headerText)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload the saved layout each time the dialog opens.
  }, [open]);

  const grid = computeGrid(layout);
  const data: StickerData | null = useMemo(
    () =>
      copy
        ? {
            code: copy.qrCode,
            title: book.title,
            author: book.author,
            publisher: book.publisher,
            category: book.category,
            language: book.language,
            reading_level: book.readingLevel,
            location: copy.location,
            condition: copy.condition,
            acquisition_date: copy.acquisitionDate ? copy.acquisitionDate.slice(0, 10) : null,
            header: headerText,
          }
        : null,
    [book, copy, headerText],
  );
  const pages = useMemo(() => (data ? paginate([data], grid.perPage, cell) : []), [data, grid.perPage, cell]);
  const row = Math.floor(cell / Math.max(1, grid.columns)) + 1;
  const column = (cell % Math.max(1, grid.columns)) + 1;
  const setPosition = (r: number, c: number) => {
    const rr = Math.min(Math.max(1, r), Math.max(1, grid.rows));
    const cc = Math.min(Math.max(1, c), Math.max(1, grid.columns));
    setCell((rr - 1) * grid.columns + (cc - 1));
  };

  const handlePrint = () => {
    setError(null);
    const ok = printStickers(layout, pages, {
      title: t('library_catalog.print_sticker.title', { code: copy?.qrCode ?? '' }),
      print: t('library_catalog.print_codes.print_button'),
      hint: t('library_catalog.print_codes.print_hint', { width: layout.page.widthMm, height: layout.page.heightMm }),
    });
    if (!ok) setError(t('library_catalog.print_codes.popup_blocked'));
  };
  const handlePdf = async () => {
    setError(null);
    setPdfBusy(true);
    try {
      await downloadStickersPdf(layout, pages, `sticker-${copy?.qrCode ?? 'copy'}.pdf`);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_catalog.print_sticker.title', { code: copy?.qrCode ?? '' })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {grid.perPage < 1 ? (
            <Alert severity="warning">{t('library_catalog.designer.fits_none')}</Alert>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                {t('library_catalog.print_sticker.hint', { columns: grid.columns, rows: grid.rows })}
              </Typography>
              <Stack direction="row" spacing={1.5}>
                <TextField size="small" type="number" label={t('library_catalog.print_codes.start_row')} value={row} onChange={(e) => setPosition(Number(e.target.value) || 1, column)} slotProps={{ htmlInput: { min: 1, max: grid.rows, inputMode: 'numeric' } }} sx={{ width: 110 }} />
                <TextField size="small" type="number" label={t('library_catalog.print_codes.start_column')} value={column} onChange={(e) => setPosition(row, Number(e.target.value) || 1)} slotProps={{ htmlInput: { min: 1, max: grid.columns, inputMode: 'numeric' } }} sx={{ width: 110 }} />
              </Stack>
              {phonePrinting ? <Typography variant="body2" color="text.secondary">{t('library_catalog.print_codes.phone_hint')}</Typography> : null}
              <Box sx={{ textAlign: 'center' }}>
                <PageGridPreview layout={layout} cells={pages[0] ?? []} maxWidthPx={320} selectedCell={cell} onSelectCell={setCell} />
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.close')}</Button>
        <Button startIcon={<PictureAsPdfIcon />} variant={phonePrinting ? 'contained' : 'text'} disabled={!data || grid.perPage < 1 || pdfBusy} onClick={() => void handlePdf()}>
          {pdfBusy ? t('library_catalog.print_codes.pdf_busy') : t('library_catalog.print_codes.pdf_button')}
        </Button>
        {phonePrinting ? null : (
          <Button variant="contained" startIcon={<PrintIcon />} disabled={!data || grid.perPage < 1} onClick={handlePrint}>
            {t('library_catalog.print_codes.print_button')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
