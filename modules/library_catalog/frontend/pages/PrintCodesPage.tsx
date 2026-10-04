import DownloadIcon from '@mui/icons-material/Download';
import PrintIcon from '@mui/icons-material/Print';
import SaveIcon from '@mui/icons-material/Save';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { downloadBlob, libraryCatalogApi, type CopyForPrint } from '../api';
import { QrCodeImage } from './QrCodeImage';

/**
 * "filter the books entered last period ... export the book names,
 * copy-number and the QR for the copies ... the aim is to print the book
 * stickers" (LIBRARY_CATALOG-D22). `bookTitle` is shown in the on-screen
 * preview table and the Excel export ONLY, for the librarian to validate
 * the filtered set before printing — it is deliberately never part of the
 * sticker itself (confirmed with the user). Each sticker shows: the
 * configured header text (e.g. the school/library name, a per-installation
 * setting below), the copy's QR code image, its code as text, and its
 * location.
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const handlePrint = () => window.print();

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
              <Button startIcon={<PrintIcon />} variant="contained" onClick={handlePrint} disabled={copies.length === 0}>
                {t('library_catalog.print_codes.print_button')}
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('library_catalog.print_codes.preview_hint')}
        </Typography>

        {/* Preview table — book title shown for validation only, never printed on the sticker (see this page's own docblock). */}
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
                copies.map((copy) => (
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
      </Box>

      {/* The actual sticker sheet — present at all times (so Ctrl+P / browser
          print-preview also works, not just the Print button), hidden on
          screen and shown only inside @media print via the stylesheet
          below. Fixed label-grid layout, not admin-configurable (confirmed
          with the user) — 3 stickers per row, a plain CSS grid wrap.
          This page's own print rule only reaches content INSIDE this page
          — the app shell (sidebar/top bar) that used to print alongside it
          is hidden by a separate, platform-level rule in App.tsx's
          GlobalStyles (reported bug: "when printing the stickers the menu
          is shown to the side of the page"). See that file's own comment
          for why a per-page rule alone can never reach the shell. */}
      <Box className="print-codes-sheet">
        {copies.map((copy) => (
          <Box key={copy.id} className="print-codes-sticker">
            {headerText ? <Typography className="print-codes-sticker-header">{headerText}</Typography> : null}
            <QrCodeImage value={copy.qrCode} size={96} />
            <Typography className="print-codes-sticker-code">{copy.qrCode}</Typography>
            {copy.location ? <Typography className="print-codes-sticker-location">{copy.location}</Typography> : null}
          </Box>
        ))}
      </Box>

      <style>{`
        .print-codes-sheet { display: none; }
        @media print {
          .print-codes-controls { display: none; }
          .print-codes-sheet {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          }
          .print-codes-sticker {
            box-sizing: border-box;
            border: 1px solid #000;
            padding: 6px;
            width: 63.5mm;
            height: 38.1mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            overflow: hidden;
            break-inside: avoid;
          }
          .print-codes-sticker-header { font-size: 8pt; font-weight: bold; margin: 0; }
          .print-codes-sticker-code { font-size: 9pt; margin: 2px 0 0; }
          .print-codes-sticker-location { font-size: 7pt; color: #333; margin: 0; }
        }
      `}</style>
    </Box>
  );
}
