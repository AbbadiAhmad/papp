import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import InventoryIcon from '@mui/icons-material/Inventory2';
import AssessmentIcon from '@mui/icons-material/Assessment';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import ReplayIcon from '@mui/icons-material/Replay';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { Allowed } from '../components/Allowed';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly, formatDateTime } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { surveyApi, type SurveyStatus, type SurveySummary } from '../api';
import { DuplicateSurveyDialog, ExportPackageButton, ImportSurveyDialog } from '../components/SurveyTransfer';
import { Paginated } from '../../../../apps/web/src/shared/components/Paginated';
import { SharePanel } from '../components/SharePanel';

const STATUS_COLOR: Record<SurveyStatus, 'default' | 'success' | 'warning'> = {
  draft: 'default',
  published: 'success',
  closed: 'warning',
};

function CreateSurveyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const survey = await gated('survey.surveys.create', () => surveyApi.create({ title, description: description || undefined }));
      handleClose();
      onCreated(survey.id);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('survey.list.create_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('survey.fields.title')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
          <TextField
            label={t('survey.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('core.common.cancel')}</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!title.trim() || saving}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function SurveysListPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const gated = useGatedCall();
  const { status, data: surveys, errorMessage, reload } = useGuardedQuery(() => surveyApi.list());

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<SurveySummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SurveySummary | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [linkSnackbar, setLinkSnackbar] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<SurveySummary | null>(null);
  // `busyId` blocks a second click on the same row while a status call is in
  // flight; `pendingStatus` makes close/reopen an explicit confirmed step so a
  // double-click on the publish button (which turns into the close button in
  // the same spot) can no longer close a survey straight after publishing it.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{ survey: SurveySummary; action: 'close' | 'reopen' } | null>(null);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('survey.surveys.delete', () => surveyApi.remove(pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  const runStatusChange = async (survey: SurveySummary, call: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(survey.id);
    try {
      await gated('survey.surveys.publish', call);
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const handlePublish = (survey: SurveySummary) => runStatusChange(survey, () => surveyApi.publish(survey.id));

  const handleConfirmStatus = async () => {
    if (!pendingStatus) return;
    const { survey, action } = pendingStatus;
    setPendingStatus(null);
    await runStatusChange(survey, () => (action === 'close' ? surveyApi.close(survey.id) : surveyApi.reopen(survey.id)));
  };

  const handleArchive = (survey: SurveySummary) => runStatusChange(survey, () => surveyApi.archive(survey.id));

  const copyShareLink = async (survey: SurveySummary) => {
    const url = `${window.location.origin}/survey/${survey.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkSnackbar(t('survey.list.link_copied'));
    } catch {
      setLinkSnackbar(url);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5">{t('survey.menu.root')}</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button startIcon={<InventoryIcon />} onClick={() => navigate('/survey/surveys/archived')}>
            {t('survey.archive.open_page')}
          </Button>
          <Can permission="survey.surveys.import">
            <Button startIcon={<FileUploadIcon />} onClick={() => setImportOpen(true)}>
              {t('survey.transfer.import')}
            </Button>
          </Can>
          <Can permission="survey.surveys.create">
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreateOpen(true)}>
              {t('survey.list.create_button')}
            </Button>
          </Can>
        </Stack>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <Paginated items={(surveys ?? [])}>
        {(pageRows) => (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('survey.fields.title')}</TableCell>
                <TableCell>{t('survey.fields.status')}</TableCell>
                <TableCell>{t('survey.fields.requires_login')}</TableCell>
                <TableCell>{t('survey.fields.response_count')}</TableCell>
                <TableCell>{t('survey.fields.created_at')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map((survey) => (
                <TableRow key={survey.id} hover>
                  <TableCell>
                    <RouterLink to={`/survey/surveys/${survey.id}/edit`}>{survey.title}</RouterLink>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[survey.status]} label={t(`survey.status.${survey.status}`)} />
                    {survey.availability && survey.availability !== 'open' ? (
                      <Chip size="small" color="warning" variant="outlined" sx={{ ml: 0.5 }} label={t(`survey.availability.${survey.availability}`)} />
                    ) : null}
                    {survey.status === 'published' && survey.availability === 'not_open_yet' && survey.opensAt ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {t('survey.availability.opens_on', { date: formatDateTime(survey.opensAt, language) })}
                      </Typography>
                    ) : null}
                    {survey.status === 'published' && survey.availability === 'open' && survey.closesAt ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {t('survey.availability.closes_on', { date: formatDateTime(survey.closesAt, language) })}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{survey.requiresLogin ? t('core.common.yes') : t('core.common.no')}</TableCell>
                  <TableCell>{survey.responseLimit ? `${survey.responseCount} / ${survey.responseLimit}` : survey.responseCount}</TableCell>
                  <TableCell>{formatDateOnly(survey.createdAt, language)}</TableCell>
                  <TableCell align="right">
                    {survey.status !== 'draft' ? (
                      <Tooltip title={t('survey.list.copy_link')}>
                        <IconButton size="small" onClick={() => copyShareLink(survey)} aria-label={t('survey.list.copy_link')}>
                          <LinkIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Tooltip title={t('survey.share.button')}>
                      <IconButton size="small" onClick={() => setShareTarget(survey)} aria-label={t('survey.share.button')}>
                        <QrCode2Icon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Allowed permission="survey.responses.view" orSurvey={survey.access?.canViewResults}>
                      <Tooltip title={t('survey.list.responses')}>
                        <IconButton size="small" onClick={() => navigate(`/survey/surveys/${survey.id}/responses`)}>
                          <ListAltIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('survey.list.report')}>
                        <IconButton size="small" onClick={() => navigate(`/survey/surveys/${survey.id}/report`)}>
                          <AssessmentIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Allowed>
                    <Allowed permission="survey.surveys.update" orSurvey={survey.access?.canEdit}>
                      <Tooltip title={t('core.common.edit')}>
                        <IconButton size="small" onClick={() => navigate(`/survey/surveys/${survey.id}/edit`)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Allowed>
                    <Allowed permission="survey.surveys.publish" orSurvey={survey.access?.canPublish}>
                      {survey.status === 'published' ? (
                        <Tooltip title={t('survey.list.close')}>
                          <span>
                            <IconButton size="small" disabled={busyId !== null} onClick={() => setPendingStatus({ survey, action: 'close' })}>
                              <PauseCircleIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : survey.status === 'closed' ? (
                        <Tooltip title={t('survey.list.reopen')}>
                          <span>
                            <IconButton size="small" disabled={busyId !== null} onClick={() => setPendingStatus({ survey, action: 'reopen' })}>
                              <ReplayIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip title={t('survey.list.publish')}>
                          <span>
                            <IconButton size="small" disabled={busyId !== null} onClick={() => handlePublish(survey)}>
                              <PlayCircleIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </Allowed>
                    <Can permission="survey.surveys.create">
                      <Tooltip title={t('survey.transfer.duplicate')}>
                        <IconButton size="small" onClick={() => setDuplicating(survey)} aria-label={t('survey.transfer.duplicate')}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Can>
                    <ExportPackageButton survey={survey} onError={setSnackbar} />
                    <Can permission="survey.surveys.archive">
                      <Tooltip title={t('survey.archive.archive')}>
                        <span>
                          <IconButton size="small" disabled={busyId !== null} onClick={() => handleArchive(survey)} aria-label={t('survey.archive.archive')}>
                            <ArchiveIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Can>
                    <Can permission="survey.surveys.delete">
                      <Tooltip title={t('core.common.delete')}>
                        <IconButton size="small" onClick={() => setPendingDelete(survey)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        )}
        </Paginated>
      </QueryStateGate>

      <CreateSurveyDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => navigate(`/survey/surveys/${id}/edit`)} />

      {duplicating ? (
        <DuplicateSurveyDialog
          key={duplicating.id}
          survey={duplicating}
          onClose={() => setDuplicating(null)}
          onDuplicated={(id) => navigate(`/survey/surveys/${id}/edit`)}
        />
      ) : null}
      <ImportSurveyDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={(id) => navigate(`/survey/surveys/${id}/edit`)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('survey.list.delete_title')}
        description={t('survey.list.delete_confirm', { title: pendingDelete?.title ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={pendingStatus !== null}
        title={pendingStatus?.action === 'reopen' ? t('survey.list.reopen_title') : t('survey.list.close_title')}
        description={pendingStatus?.action === 'reopen' ? t('survey.list.reopen_confirm') : t('survey.list.close_confirm')}
        confirmLabel={pendingStatus?.action === 'reopen' ? t('survey.list.reopen') : t('survey.list.close')}
        onCancel={() => setPendingStatus(null)}
        onConfirm={handleConfirmStatus}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={5000} onClose={() => setSnackbar(null)}>
        <Alert severity="error" onClose={() => setSnackbar(null)}>
          {snackbar}
        </Alert>
      </Snackbar>
      <SharePanel
        open={shareTarget !== null}
        onClose={() => setShareTarget(null)}
        surveyId={shareTarget?.id ?? ''}
        title={shareTarget?.title ?? ''}
        published={shareTarget?.status === 'published'}
      />
      <Snackbar open={linkSnackbar !== null} autoHideDuration={4000} onClose={() => setLinkSnackbar(null)} message={linkSnackbar} />
    </Box>
  );
}
