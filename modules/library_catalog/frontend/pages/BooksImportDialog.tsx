import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { Paginated } from '../../../../apps/web/src/shared/components/Paginated';
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { libraryCatalogApi, type BooksImportReport } from '../api';

/** Preview first (writes nothing), then commit — all-or-nothing, like the Users and Readers imports. */
export function BooksImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<BooksImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setReport(null);
    setCommitted(false);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const handleFile = async (selected: File | undefined) => {
    if (!selected) return;
    reset();
    setFile(selected);
    setBusy(true);
    try {
      setReport(await gated('library_catalog.books.import', () => libraryCatalogApi.importBooksPreview(selected)));
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleCommit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gated('library_catalog.books.import', () => libraryCatalogApi.importBooksCommit(file));
      setReport(result);
      if (result.allValid) {
        setCommitted(true);
        onImported();
      }
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>{t('library_catalog.import.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('library_catalog.import.help')}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <input ref={inputRef} type="file" accept=".xlsx" hidden data-testid="books-import-input" aria-label={t('library_catalog.import.choose_file')} onChange={(e) => void handleFile(e.target.files?.[0])} />
          <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={busy} sx={{ alignSelf: 'flex-start' }}>
            {file ? file.name : t('library_catalog.import.choose_file')}
          </Button>
          {report ? (
            <>
              <Alert severity={committed ? 'success' : report.allValid ? 'info' : 'warning'}>
                {committed
                  ? t('library_catalog.import.committed', { created: report.created ?? 0, updated: report.updated ?? 0 })
                  : report.allValid
                    ? t('library_catalog.import.all_valid', { count: report.validCount })
                    : t('library_catalog.import.has_errors', { invalid: report.invalidCount, valid: report.validCount })}
              </Alert>
              <Paginated items={report.rows}>
                {(pageRows) => (
                  <TableContainer sx={{ maxHeight: 360 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('library_catalog.import.row')}</TableCell>
                          <TableCell>{t('library_catalog.fields.title')}</TableCell>
                          <TableCell>{t('library_catalog.import.action')}</TableCell>
                          <TableCell>{t('library_catalog.import.changes')}</TableCell>
                          <TableCell>{t('library_catalog.import.error')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {pageRows.map((row) => (
                          <TableRow key={row.row}>
                            <TableCell>{row.row}</TableCell>
                            <TableCell>{row.title ?? '—'}</TableCell>
                            <TableCell>
                              {row.valid && row.action ? (
                                <Chip size="small" color={row.action === 'create' ? 'success' : row.action === 'update' ? 'info' : 'default'} label={t(`library_catalog.import.action_${row.action}`)} />
                              ) : (
                                <Chip size="small" color="error" label={t('library_catalog.import.invalid')} />
                              )}
                            </TableCell>
                            <TableCell>{row.changes.join(', ')}</TableCell>
                            <TableCell>{row.error ?? ''}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Paginated>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('core.common.close')}</Button>
        {report?.allValid && !committed ? (
          <Button variant="contained" onClick={() => void handleCommit()} disabled={busy}>
            {t('library_catalog.import.confirm')}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
