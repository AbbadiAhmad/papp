import DownloadIcon from '@mui/icons-material/Download';
import PrintIcon from '@mui/icons-material/Print';
import SaveIcon from '@mui/icons-material/Save';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { downloadBlob, libraryCatalogApi, stickerDataFromCopy, type CopyForPrint, type StickerLayout } from '../api';
import { DEFAULT_LAYOUT, computeGrid, paginate } from '../../backend/sticker-layout.ts';
import { PageGridPreview, StickerPrintPortal } from '../stickers';
import { Paginated } from '../../../../apps/web/src/shared/components/Paginated';

/**
 * Print the copy stickers (LIBRARY_CATALOG-D22, reworked in D33): filter copies by acquisition date, then print them
 * on the sheet layout saved by the sticker designer. Sheets are exact-size pages, so a sticker is never split
 * across two pages; the first sticker can start at any row/column of the first sheet (to continue on a sheet that
 * is already partly used).
 */
export function PrintCodesPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [copies, setCopies] = useState<CopyForPrint[]>([]);
  const [headerText, setHeaderText] = useState('');
  const [headerTextDraft, setHeaderTextDraft] = useState('');
  const [layout, setLayout] = useState<StickerLayout>(DEFAULT_LAYOUT);
  // Where the first sticker goes on the first sheet (0-based cell index): lets the librarian continue on a part-used sheet.
  const [startCell, setStartCell] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    libraryCatalogApi.getStickerLayout().then(setLayout).catch(() => undefined);
  }, []);

  useEffect(() => {
    libraryCatalogApi
      .getStickerSettings()
      .then((settings) => {
        setHeaderText(settings.headerText);
        setHeaderTextDraft(settings.headerText);
      })
      .catch(() => undefined);
  }, []);

  const runSearch = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await libraryCatalogApi.listCopiesForPrint({ from: from || undefined, to: to || undefined });
      setCopies(result);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Load the full, unfiltered set once on mount so the page isn't empty
  // before the librarian picks a date range.
  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only load; runSearch itself reads the latest from/to when called from the filter button.
  }, []);

  const handleExport = async () => {
    setError(null);
    try {
      const blob = await gated('library_catalog.copies.print_codes', () =>
        libraryCatalogApi.exportCopiesForPrint({ from: from || undefined, to: to || undefined }),
      );
      downloadBlob(blob, 'library-catalog-copy-stickers-export.xlsx');
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const grid = computeGrid(layout);
  const pages = useMemo(
    () => paginate(copies.map((copy) => stickerDataFromCopy(copy, headerText)), grid.perPage, startCell),
    [copies, headerText, grid.perPage, startCell],
  );
  const handlePrint = () => setPrinting(true);
  const startRow = Math.floor(startCell / Math.max(1, grid.columns)) + 1;
  const startColumn = (startCell % Math.max(1, grid.columns)) + 1;
  const setStart = (row: number, column: number) => {
    const r = Math.min(Math.max(1, row), Math.max(1, grid.rows));
    const c = Math.min(Math.max(1, column), Math.max(1, grid.columns));
    setStartCell((r - 1) * grid.columns + (c - 1));
  };

  const handleSaveHeaderText = async () => {
    setError(null);
    setMessage(null);
    try {
      await gated('library_catalog.settings.update', () => libraryCatalogApi.updateStickerSettings({ headerText: headerTextDraft }));
      setHeaderText(headerTextDraft);
      setMessage(t('library_catalog.print_codes.settings_saved'));
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Box>
      {/* Screen-only controls — hidden on the printed page via the stylesheet below. */}
      <Box className="print-codes-controls">
        <Typography variant="h5" gutterBottom>
          {t('library_catalog.menu.print_codes')}
        </Typography>

        <Can permission="library_catalog.settings.update">
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                {t('library_catalog.settings.sticker_header_text_label')}
              </Typography>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  label={t('library_catalog.settings.sticker_header_text_label')}
                  value={headerTextDraft}
                  onChange={(e) => setHeaderTextDraft(e.target.value)}
                  sx={{ minWidth: 280 }}
                />
                <Button startIcon={<SaveIcon />} variant="outlined" onClick={handleSaveHeaderText} disabled={headerTextDraft === headerText}>
                  {t('core.common.save')}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Can>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {message ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            {message}
          </Alert>
        ) : null}

        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                label={t('library_catalog.print_codes.from_date')}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label={t('library_catalog.print_codes.to_date')}
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Button variant="contained" onClick={runSearch} disabled={loading}>
                {t('library_catalog.print_codes.filter_button')}
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              <Button startIcon={<DownloadIcon />} variant="outlined" onClick={handleExport} disabled={copies.length === 0}>
                {t('library_catalog.actions.export')}
              </Button>
              <Button startIcon={<PrintIcon />} variant="contained" onClick={handlePrint} disabled={copies.length === 0 || grid.perPage < 1 || printing}>
                {t('library_catalog.print_codes.print_button')}
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
              <Typography variant="subtitle2">{t('library_catalog.print_codes.sheet_title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {grid.perPage > 0
                  ? t('library_catalog.print_codes.sheet_summary', { width: layout.page.widthMm, height: layout.page.heightMm, columns: grid.columns, rows: grid.rows, count: grid.perPage, pages: pages.length })
                  : t('library_catalog.designer.fits_none')}
              </Typography>
              <Can permission="library_catalog.settings.update">
                <Link component={RouterLink} to="/library/copies/sticker-designer">
                  {t('library_catalog.print_codes.open_designer')}
                </Link>
              </Can>
            </Stack>
            {grid.perPage > 0 ? (
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
                <Stack spacing={1.5}>
                  <Typography variant="body2" color="text.secondary">{t('library_catalog.print_codes.start_hint')}</Typography>
                  <Stack direction="row" spacing={1.5}>
                    <TextField
                      size="small"
                      type="number"
                      label={t('library_catalog.print_codes.start_row')}
                      value={startRow}
                      onChange={(e) => setStart(Number(e.target.value) || 1, startColumn)}
                      slotProps={{ htmlInput: { min: 1, max: grid.rows, inputMode: 'numeric' } }}
                      sx={{ width: 110 }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label={t('library_catalog.print_codes.start_column')}
                      value={startColumn}
                      onChange={(e) => setStart(startRow, Number(e.target.value) || 1)}
                      slotProps={{ htmlInput: { min: 1, max: grid.columns, inputMode: 'numeric' } }}
                      sx={{ width: 110 }}
                    />
                  </Stack>
                </Stack>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {t('library_catalog.print_codes.first_sheet')}
                  </Typography>
                  <PageGridPreview layout={layout} cells={pages[0] ?? []} maxWidthPx={300} selectedCell={startCell} onSelectCell={setStartCell} />
                </Box>
              </Stack>
            ) : null}
          </CardContent>
        </Card>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('library_catalog.print_codes.preview_hint')}
        </Typography>

        {/* Preview table — book title shown for validation only, never printed on the sticker (see this page's own docblock). */}
        <Paginated items={copies}>
          {(pageRows) => (
        <TableContainer component={Card} sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_catalog.fields.title')}</TableCell>
                <TableCell>{t('library_catalog.copies.qr_code')}</TableCell>
                <TableCell>{t('library_catalog.copies.location')}</TableCell>
                <TableCell>{t('library_catalog.copies.acquisition_date')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {copies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary">
                      {t('library_catalog.print_codes.no_copies')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((copy) => (
                  <TableRow key={copy.id}>
                    <TableCell>{copy.bookTitle}</TableCell>
                    <TableCell>{copy.qrCode}</TableCell>
                    <TableCell>{copy.location ?? '—'}</TableCell>
                    <TableCell>{copy.acquisitionDate ? formatDateOnly(copy.acquisitionDate, language) : '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
          )}
        </Paginated>
      </Box>

      {printing ? <StickerPrintPortal layout={layout} pages={pages} onDone={() => setPrinting(false)} /> : null}
    </Box>
  );
}
