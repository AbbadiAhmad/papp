import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
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
import { useNavigate } from 'react-router-dom';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { usersApi } from '../../shared/api/users';
import { useGatedCall } from '../../shared/permissions';
import type { ImportReport } from '../../shared/api/types';

/**
 * D42 (docs/DECISIONS.md) / excel-import.controller.ts: preview NEVER
 * writes — it re-parses the uploaded file and returns a per-row validation
 * report; commit RE-VALIDATES FROM SCRATCH (never trusts the client-held
 * preview as ground truth) and commits ALL-OR-NOTHING. The UI mirrors that:
 * "Commit" stays enabled even if the preview found errors (the backend is
 * the real gate and will reject the whole file again), but a clear banner
 * warns the operator before they try.
 */
export function UsersImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gated = useGatedCall();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [commitResult, setCommitResult] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFileChange = async (selected: File | null) => {
    setFile(selected);
    setPreview(null);
    setCommitResult(null);
    setError(null);
    if (!selected) return;
    setBusy(true);
    try {
      const report = await gated('users.import', () => usersApi.importPreview(selected));
      setPreview(report);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const report = await gated('users.import', () => usersApi.importCommit(file));
      setCommitResult(report);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const activeReport = commitResult ?? preview;

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.users.import')}
      </Typography>

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />
        <Button startIcon={<UploadFileIcon />} variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          {t('core.users.choose_file')}
        </Button>
        {file ? <Typography variant="body2">{file.name}</Typography> : null}
        <Button onClick={() => navigate('/users')}>{t('core.common.cancel')}</Button>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {commitResult ? (
        <Alert severity={commitResult.allValid ? 'success' : 'error'} sx={{ mb: 2 }}>
          {commitResult.allValid
            ? t('core.users.import_committed', { valid: commitResult.validCount })
            : t('core.users.import_rejected')}
        </Alert>
      ) : preview ? (
        <Alert severity={preview.allValid ? 'success' : 'warning'} sx={{ mb: 2 }}>
          {preview.allValid
            ? t('core.users.import_preview_all_valid', { count: preview.validCount })
            : t('core.users.import_preview_has_errors', { invalid: preview.invalidCount, valid: preview.validCount })}
        </Alert>
      ) : null}

      {activeReport ? (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('core.users.import_row')}</TableCell>
                <TableCell>{t('core.auth.name')}</TableCell>
                <TableCell>{t('core.auth.email')}</TableCell>
                <TableCell>{t('core.users.external_id')}</TableCell>
                <TableCell>{t('core.users.import_role')}</TableCell>
                <TableCell>{t('core.users.import_action')}</TableCell>
                <TableCell>{t('core.users.import_error')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {activeReport.rows.map((row) => (
                <TableRow
                  key={row.row}
                  sx={row.valid ? undefined : (theme) => ({ backgroundColor: theme.palette.error.light })}
                >
                  <TableCell>{row.row}</TableCell>
                  <TableCell>{row.name ?? '—'}</TableCell>
                  <TableCell>{row.email ?? '—'}</TableCell>
                  <TableCell>{row.externalId ?? '—'}</TableCell>
                  <TableCell>{row.roleCode ?? '—'}</TableCell>
                  <TableCell>
                    {row.valid ? (
                      <Chip size="small" color="info" label={row.action ?? '—'} />
                    ) : (
                      <Chip size="small" color="error" label={t('core.users.import_invalid')} />
                    )}
                  </TableCell>
                  <TableCell sx={{ color: row.error ? 'error.main' : undefined }}>{row.error ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      {preview && !commitResult ? (
        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleCommit} disabled={busy}>
            {t('core.users.import_confirm')}
          </Button>
        </Stack>
      ) : null}

      {commitResult ? (
        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={() => navigate('/users')}>
            {t('core.users.import_back_to_list')}
          </Button>
        </Stack>
      ) : null}
    </Box>
  );
}
