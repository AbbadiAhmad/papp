import PrintIcon from '@mui/icons-material/Print';
import SaveIcon from '@mui/icons-material/Save';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  MenuItem,
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
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { Paginated } from '../../../../apps/web/src/shared/components/Paginated';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { libraryCirculationApi, type LibraryStudent } from '../api';
import { QrCodeImage } from './QrCodeImage';

type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * Prints reader ID cards (credit-card size, 85.6 x 54 mm): the librarian
 * filters the readers, ticks the ones to print and presses Print. Each card
 * shows the configured custom text (library name etc. — a per-installation
 * setting edited here), the reader's name, the code as text and as a QR
 * code. Mirrors library_catalog's PrintCodesPage: a screen-only controls
 * block plus a print-only sheet that is always in the DOM, so Ctrl+P works
 * too; the app shell is hidden by the platform-level print rule in App.tsx.
 */
export function ReaderCardsPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [readers, setReaders] = useState<LibraryStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [className, setClassName] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [headerText, setHeaderText] = useState('');
  const [headerTextDraft, setHeaderTextDraft] = useState('');

  useEffect(() => {
    libraryCirculationApi
      .listStudentsForCards()
      .then(setReaders)
      .catch((err: unknown) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
    libraryCirculationApi
      .getReaderCardSettings()
      .then((settings) => {
        setHeaderText(settings.headerText);
        setHeaderTextDraft(settings.headerText);
      })
      .catch(() => undefined);
  }, []);

  const classNames = useMemo(
    () => [...new Set(readers.map((r) => r.className).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [readers],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return readers.filter((r) => {
      if (status === 'active' && !r.isActive) return false;
      if (status === 'inactive' && r.isActive) return false;
      if (className && r.className !== className) return false;
      if (q && !`${r.name ?? ''} ${r.code} ${r.email ?? ''} ${r.className ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [readers, search, className, status]);

  const toPrint = useMemo(() => readers.filter((r) => selected.has(r.id)), [readers, selected]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someFilteredSelected = filtered.some((r) => selected.has(r.id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });

  const handleSaveHeaderText = async () => {
    setError(null);
    setMessage(null);
    try {
      await gated('library_circulation.settings.update', () => libraryCirculationApi.updateReaderCardSettings({ headerText: headerTextDraft }));
      setHeaderText(headerTextDraft);
      setMessage(t('library_circulation.reader_cards.settings_saved'));
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Box>
      <Box className="reader-cards-controls">
        <Typography variant="h5" gutterBottom>
          {t('library_circulation.reader_cards.title')}
        </Typography>

        <Can permission="library_circulation.settings.update">
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <TextField
                  label={t('library_circulation.reader_cards.header_text')}
                  helperText={t('library_circulation.reader_cards.header_text_help')}
                  value={headerTextDraft}
                  onChange={(e) => setHeaderTextDraft(e.target.value)}
                  multiline
                  maxRows={4}
                  slotProps={{ htmlInput: { maxLength: 300 } }}
                  sx={{ minWidth: 320, flexGrow: 1 }}
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
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 2 }}>
              <TextField
                size="small"
                label={t('library_circulation.reader_cards.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ minWidth: 220 }}
              />
              <TextField select size="small" label={t('library_circulation.students.class')} value={className} onChange={(e) => setClassName(e.target.value)} sx={{ minWidth: 160 }}>
                <MenuItem value="">{t('library_circulation.reader_cards.all_classes')}</MenuItem>
                {classNames.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label={t('library_circulation.reader_cards.status')} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} sx={{ minWidth: 140 }}>
                <MenuItem value="all">{t('library_circulation.reader_cards.status_all')}</MenuItem>
                <MenuItem value="active">{t('library_circulation.reader_cards.status_active')}</MenuItem>
                <MenuItem value="inactive">{t('library_circulation.reader_cards.status_inactive')}</MenuItem>
              </TextField>
              <Box sx={{ flexGrow: 1 }} />
              <Chip label={t('library_circulation.reader_cards.selected_count', { count: toPrint.length })} />
              <Button variant="outlined" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                {t('library_circulation.reader_cards.clear_selection')}
              </Button>
              <Button startIcon={<PrintIcon />} variant="contained" onClick={() => window.print()} disabled={toPrint.length === 0}>
                {t('library_circulation.reader_cards.print_button')}
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Paginated items={filtered}>
          {(pageRows) => (
            <TableContainer component={Card} sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={allFilteredSelected}
                        indeterminate={someFilteredSelected && !allFilteredSelected}
                        onChange={toggleAllFiltered}
                        disabled={filtered.length === 0}
                        slotProps={{ input: { 'aria-label': t('library_circulation.reader_cards.select_all') } }}
                      />
                    </TableCell>
                    <TableCell>{t('library_circulation.students.code')}</TableCell>
                    <TableCell>{t('library_circulation.students.name')}</TableCell>
                    <TableCell>{t('library_circulation.students.class')}</TableCell>
                    <TableCell>{t('library_circulation.reader_cards.status')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          {loading ? t('core.common.loading') : t('library_circulation.reader_cards.no_readers')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pageRows.map((reader) => (
                      <TableRow key={reader.id} hover selected={selected.has(reader.id)}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={selected.has(reader.id)}
                            onChange={() => toggleOne(reader.id)}
                            slotProps={{ input: { 'aria-label': reader.name ?? reader.code } }}
                          />
                        </TableCell>
                        <TableCell>{reader.code}</TableCell>
                        <TableCell>{reader.name ?? '—'}</TableCell>
                        <TableCell>{reader.className ?? '—'}</TableCell>
                        <TableCell>
                          {reader.isActive
                            ? t('library_circulation.reader_cards.status_active')
                            : t('library_circulation.reader_cards.status_inactive')}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paginated>
      </Box>

      {/* Print-only sheet: always present (so Ctrl+P works), hidden on screen. */}
      <Box className="reader-cards-sheet">
        {toPrint.map((reader) => (
          <Box key={reader.id} className="reader-card">
            {headerText ? <Typography className="reader-card-header">{headerText}</Typography> : null}
            <Box className="reader-card-body">
              <Box className="reader-card-text">
                <Typography className="reader-card-name">{reader.name ?? reader.code}</Typography>
                {reader.className ? <Typography className="reader-card-class">{reader.className}</Typography> : null}
                <Typography className="reader-card-code">{reader.code}</Typography>
              </Box>
              <QrCodeImage value={reader.code} size={160} />
            </Box>
          </Box>
        ))}
      </Box>

      <style>{`
        .reader-cards-sheet { display: none; }
        @media print {
          @page { size: A4; margin: 8mm; }
          .reader-cards-controls { display: none; }
          .reader-cards-sheet {
            display: grid;
            grid-template-columns: repeat(2, 85.6mm);
            gap: 2mm;
            justify-content: center;
          }
          /* ISO/IEC 7810 ID-1 (credit card): 85.6 x 54 mm */
          .reader-card {
            box-sizing: border-box;
            width: 85.6mm;
            height: 54mm;
            border: 0.3mm solid #000;
            border-radius: 3mm;
            padding: 3mm;
            display: flex;
            flex-direction: column;
            gap: 1.5mm;
            overflow: hidden;
            break-inside: avoid;
            color: #000;
          }
          .reader-card-header { font-size: 8pt; line-height: 1.2; font-weight: bold; text-align: center; margin: 0; white-space: pre-line; border-bottom: 0.2mm solid #000; padding-bottom: 1mm; overflow: hidden; max-height: 14mm; }
          .reader-card-body { flex: 1 1 0; min-height: 0; display: flex; flex-direction: row; align-items: center; gap: 3mm; }
          .reader-card-text { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 1mm; }
          .reader-card-name { font-size: 12pt; font-weight: bold; line-height: 1.2; margin: 0; word-break: break-word; }
          .reader-card-class { font-size: 9pt; margin: 0; }
          .reader-card-code { font-size: 11pt; font-family: monospace; letter-spacing: 0.5pt; margin: 0; }
          .reader-card img { width: 26mm !important; height: 26mm !important; flex: none; }
        }
      `}</style>
    </Box>
  );
}
