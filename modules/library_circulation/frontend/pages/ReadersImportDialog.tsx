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
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { libraryCirculationApi, type StudentImportReport } from '../api';

/** Preview first (writes nothing), then commit — the same two-step, all-or-nothing flow as core's Users import (D42). */
export function ReadersImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<StudentImportReport | null>(null);
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
      setReport(await gated('library_circulation.students.import', () => libraryCirculationApi.importStudentsPreview(selected)));
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gated('library_circulation.students.import', () => libraryCirculationApi.importStudentsCommit(file));
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
      <DialogTitle>{t('library_circulation.students.import_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('library_circulation.students.import_help')}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <input ref={inputRef} type="file" accept=".xlsx" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={busy} sx={{ alignSelf: 'flex-start' }}>
            {file ? file.name : t('library_circulation.students.import_choose_file')}
          </Button>
          {report ? (
            <>
              <Alert severity={committed ? 'success' : report.allValid ? 'info' : 'warning'}>
                {committed
                  ? t('library_circulation.students.import_committed', { count: report.validCount })
                  : report.allValid
                    ? t('library_circulation.students.import_all_valid', { count: report.validCount })
                    : t('library_circulation.students.import_has_errors', { invalid: report.invalidCount, valid: report.validCount })}
              </Alert>
              {committed ? <Alert severity="info">{t('library_circulation.students.import_passwords_note')}</Alert> : null}
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>{t('library_circulation.students.code')}</TableCell>
                      <TableCell>{t('library_circulation.students.name')}</TableCell>
                      <TableCell>{t('core.auth.email')}</TableCell>
                      <TableCell>{t('library_circulation.students.import_action')}</TableCell>
                      <TableCell>{t('library_circulation.students.import_error')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.rows.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell>{row.row}</TableCell>
                        <TableCell>{row.code ?? (row.action === 'create' ? t('library_circulation.students.import_auto_code') : '—')}</TableCell>
                        <TableCell>{row.name ?? '—'}</TableCell>
                        <TableCell>{row.email ?? '—'}</TableCell>
                        <TableCell>
                          {row.valid ? (
                            <Chip size="small" color={row.action === 'create' ? 'success' : 'info'} label={t(`library_circulation.students.import_action_${row.action}`)} />
                          ) : (
                            <Chip size="small" color="error" label={t('library_circulation.students.import_invalid')} />
                          )}
                        </TableCell>
                        <TableCell>{row.error ?? ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('core.common.close')}</Button>
        {report?.allValid && !committed ? (
          <Button variant="contained" onClick={handleCommit} disabled={busy}>
            {t('library_circulation.students.import_confirm')}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
