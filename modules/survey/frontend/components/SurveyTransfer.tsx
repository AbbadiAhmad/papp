import FileDownloadIcon from '@mui/icons-material/FileDownload';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { usePermission, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { downloadBlob, surveyApi, type SurveySummary } from '../api';

/**
 * Copies any survey (whatever its status, archived included) into a new draft.
 * Mount it only while a survey is selected, keyed by the survey id, so the
 * suggested title is seeded from props once and never needs a sync effect.
 */
export function DuplicateSurveyDialog({
  survey,
  onClose,
  onDuplicated,
}: {
  survey: SurveySummary;
  onClose: () => void;
  onDuplicated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [title, setTitle] = useState(() => t('survey.transfer.copy_title', { title: survey.title }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleDuplicate = async () => {
    setBusy(true);
    setError(null);
    try {
      const copy = await gated('survey.surveys.create', () => surveyApi.duplicate(survey.id, title.trim()));
      onDuplicated(copy.id);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('survey.transfer.duplicate_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('survey.transfer.duplicate_hint')}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('survey.fields.title')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
        <Button variant="contained" onClick={handleDuplicate} disabled={!title.trim() || busy}>
          {t('survey.transfer.duplicate')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Download a survey as a zipped JSON package, with or without its responses. */
export function ExportPackageButton({ survey, onError }: { survey: SurveySummary; onError: (message: string) => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const canExport = usePermission('survey.surveys.export');
  const canExportResponses = usePermission('survey.responses.export');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canExport && !canExportResponses) return null;

  const run = async (withResponses: boolean) => {
    setAnchor(null);
    setBusy(true);
    try {
      const blob = await gated(withResponses ? 'survey.responses.export' : 'survey.surveys.export', () =>
        surveyApi.exportPackage(survey.id, withResponses),
      );
      downloadBlob(blob, `${survey.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'survey'}${withResponses ? '-with-responses' : ''}.zip`);
    } catch (e) {
      onError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title={t('survey.transfer.export')}>
        <span>
          <IconButton size="small" disabled={busy} onClick={(e) => setAnchor(e.currentTarget)} aria-label={t('survey.transfer.export')}>
            <FileDownloadIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {canExport ? <MenuItem onClick={() => run(false)}>{t('survey.transfer.export_without_responses')}</MenuItem> : null}
        {canExportResponses ? <MenuItem onClick={() => run(true)}>{t('survey.transfer.export_with_responses')}</MenuItem> : null}
      </Menu>
    </>
  );
}

/** Creates a new draft survey from a package zip previously exported from here. */
export function ImportSurveyDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (id: string) => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [includeResponses, setIncludeResponses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setFile(null);
    setIncludeResponses(false);
    setError(null);
    onClose();
  };

  const handleImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const created = await gated('survey.surveys.import', () => surveyApi.importPackage(file, includeResponses));
      close();
      onImported(created.id);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>{t('survey.transfer.import_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('survey.transfer.import_hint')}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Button variant="outlined" onClick={() => inputRef.current?.click()}>
              {t('survey.transfer.choose_file')}
            </Button>
            <Typography variant="body2">{file?.name ?? t('survey.transfer.no_file')}</Typography>
          </Stack>
          <FormControlLabel
            control={<Checkbox checked={includeResponses} onChange={(e) => setIncludeResponses(e.target.checked)} />}
            label={t('survey.transfer.import_responses')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('core.common.cancel')}</Button>
        <Button variant="contained" onClick={handleImport} disabled={!file || busy}>
          {t('survey.transfer.import')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
