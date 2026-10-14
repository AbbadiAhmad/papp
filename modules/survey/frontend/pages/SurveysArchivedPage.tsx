import AssessmentIcon from '@mui/icons-material/Assessment';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import ListAltIcon from '@mui/icons-material/ListAlt';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { Paginated } from '../../../../apps/web/src/shared/components/Paginated';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { surveyApi, type SurveyStatus, type SurveySummary } from '../api';
import { DuplicateSurveyDialog, ExportPackageButton } from '../components/SurveyTransfer';

const STATUS_COLOR: Record<SurveyStatus, 'default' | 'success' | 'warning'> = {
  draft: 'default',
  published: 'success',
  closed: 'warning',
};

/** Archived surveys: view results, restore, copy into a new draft, export, or delete for good. */
export function SurveysArchivedPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const gated = useGatedCall();
  const { status, data: surveys, errorMessage, reload } = useGuardedQuery(() => surveyApi.list(true));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<SurveySummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SurveySummary | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const handleRestore = async (survey: SurveySummary) => {
    if (busyId) return;
    setBusyId(survey.id);
    try {
      await gated('survey.surveys.archive', () => surveyApi.unarchive(survey.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

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

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5">{t('survey.archive.title')}</Typography>
        <Button onClick={() => navigate('/survey/surveys')}>{t('core.common.back')}</Button>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {(surveys ?? []).length === 0 ? (
          <Alert severity="info">{t('survey.archive.empty')}</Alert>
        ) : (
          <Paginated items={surveys ?? []}>
            {(pageRows) => (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('survey.fields.title')}</TableCell>
                      <TableCell>{t('survey.fields.status')}</TableCell>
                      <TableCell>{t('survey.fields.response_count')}</TableCell>
                      <TableCell>{t('survey.archive.archived_at')}</TableCell>
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
                        </TableCell>
                        <TableCell>{survey.responseCount}</TableCell>
                        <TableCell>{survey.archivedAt ? formatDateOnly(survey.archivedAt, language) : ''}</TableCell>
                        <TableCell align="right">
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
                          <Can permission="survey.surveys.create">
                            <Tooltip title={t('survey.transfer.duplicate')}>
                              <IconButton size="small" onClick={() => setDuplicating(survey)} aria-label={t('survey.transfer.duplicate')}>
                                <ContentCopyIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Can>
                          <ExportPackageButton survey={survey} onError={setSnackbar} />
                          <Can permission="survey.surveys.archive">
                            <Tooltip title={t('survey.archive.restore')}>
                              <span>
                                <IconButton size="small" disabled={busyId !== null} onClick={() => handleRestore(survey)} aria-label={t('survey.archive.restore')}>
                                  <UnarchiveIcon fontSize="small" />
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
        )}
      </QueryStateGate>

      {duplicating ? (
        <DuplicateSurveyDialog
          key={duplicating.id}
          survey={duplicating}
          onClose={() => setDuplicating(null)}
          onDuplicated={(id) => navigate(`/survey/surveys/${id}/edit`)}
        />
      ) : null}

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
    </Box>
  );
}
