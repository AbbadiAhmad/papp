import AddIcon from '@mui/icons-material/Add';
import AssessmentIcon from '@mui/icons-material/Assessment';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
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
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { surveyApi, type SurveyStatus, type SurveySummary } from '../api';

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
  const [pendingDelete, setPendingDelete] = useState<SurveySummary | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [linkSnackbar, setLinkSnackbar] = useState<string | null>(null);

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

  const handlePublish = async (survey: SurveySummary) => {
    try {
      await gated('survey.surveys.publish', () => surveyApi.publish(survey.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    }
  };

  const handleClose = async (survey: SurveySummary) => {
    try {
      await gated('survey.surveys.publish', () => surveyApi.close(survey.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    }
  };

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
        <Can permission="survey.surveys.create">
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreateOpen(true)}>
            {t('survey.list.create_button')}
          </Button>
        </Can>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
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
              {(surveys ?? []).map((survey) => (
                <TableRow key={survey.id} hover>
                  <TableCell>
                    <RouterLink to={`/survey/surveys/${survey.id}/edit`}>{survey.title}</RouterLink>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[survey.status]} label={t(`survey.status.${survey.status}`)} />
                  </TableCell>
                  <TableCell>{survey.requiresLogin ? t('core.common.yes') : t('core.common.no')}</TableCell>
                  <TableCell>{survey.responseCount}</TableCell>
                  <TableCell>{formatDateOnly(survey.createdAt, language)}</TableCell>
                  <TableCell align="right">
                    {survey.status !== 'draft' ? (
                      <Tooltip title={t('survey.list.copy_link')}>
                        <IconButton size="small" onClick={() => copyShareLink(survey)} aria-label={t('survey.list.copy_link')}>
                          <LinkIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Can permission="survey.responses.view">
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
                    </Can>
                    <Can permission="survey.surveys.update">
                      <Tooltip title={t('core.common.edit')}>
                        <IconButton size="small" onClick={() => navigate(`/survey/surveys/${survey.id}/edit`)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Can>
                    <Can permission="survey.surveys.publish">
                      {survey.status === 'published' ? (
                        <Tooltip title={t('survey.list.close')}>
                          <IconButton size="small" onClick={() => handleClose(survey)}>
                            <PauseCircleIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : survey.status === 'draft' ? (
                        <Tooltip title={t('survey.list.publish')}>
                          <IconButton size="small" onClick={() => handlePublish(survey)}>
                            <PlayCircleIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
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
      </QueryStateGate>

      <CreateSurveyDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => navigate(`/survey/surveys/${id}/edit`)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('survey.list.delete_title')}
        description={t('survey.list.delete_confirm', { title: pendingDelete?.title ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={5000} onClose={() => setSnackbar(null)}>
        <Alert severity="error" onClose={() => setSnackbar(null)}>
          {snackbar}
        </Alert>
      </Snackbar>
      <Snackbar open={linkSnackbar !== null} autoHideDuration={4000} onClose={() => setLinkSnackbar(null)} message={linkSnackbar} />
    </Box>
  );
}
