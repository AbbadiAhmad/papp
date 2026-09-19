import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Alert,
  Box,
  Button,
  Dialog,
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
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateTime } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { downloadBlob, surveyApi, type ResponseDetail, type ResponseListItem } from '../api';

function AnswerValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <>{value.join(', ')}</>;
  if (value === null || value === undefined) return <>—</>;
  return <>{String(value)}</>;
}

function ResponseDetailDialog({
  surveyId,
  responseId,
  questionTitleById,
  onClose,
}: {
  surveyId: string;
  responseId: string;
  questionTitleById: Map<string, string>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ResponseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    surveyApi
      .getResponse(surveyId, responseId)
      .then(setDetail)
      .catch((err: unknown) => setError(extractErrorMessage(err)));
  }, [surveyId, responseId]);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('survey.responses.detail_title')}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {detail ? (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {detail.answers.map((answer) => (
              <Box key={answer.id}>
                <Typography variant="caption" color="text.secondary">
                  {questionTitleById.get(answer.questionId) ?? answer.questionId}
                </Typography>
                <Typography variant="body2">
                  <AnswerValue value={answer.value} />
                </Typography>
              </Box>
            ))}
          </Stack>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function SurveyResponsesPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { surveyId } = useParams<{ surveyId: string }>();
  const navigate = useNavigate();
  const gated = useGatedCall();
  const { status, data: responses, errorMessage, reload } = useGuardedQuery(() =>
    surveyApi.listResponses(surveyId as string),
  );

  const [viewing, setViewing] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ResponseListItem | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [questionTitleById, setQuestionTitleById] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!surveyId) return;
    surveyApi
      .get(surveyId)
      .then((survey) => {
        const map = new Map<string, string>();
        for (const section of survey.sections) {
          for (const question of section.questions) map.set(question.id, question.title);
        }
        setQuestionTitleById(map);
      })
      .catch(() => undefined);
  }, [surveyId]);

  if (!surveyId) return null;

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('survey.responses.delete', () => surveyApi.removeResponse(surveyId, pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await gated('survey.responses.export', () => surveyApi.exportResponses(surveyId));
      downloadBlob(blob, 'survey-responses-export.xlsx');
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5">{t('survey.responses.title')}</Typography>
        <Stack direction="row" spacing={1}>
          <Button onClick={() => navigate(`/survey/surveys/${surveyId}/report`)}>{t('survey.list.report')}</Button>
          <Can permission="survey.responses.export">
            <Button startIcon={<DownloadIcon />} variant="outlined" onClick={handleExport}>
              {t('survey.responses.export')}
            </Button>
          </Can>
          <Button onClick={() => navigate('/survey/surveys')}>{t('core.common.back')}</Button>
        </Stack>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('survey.responses.respondent')}</TableCell>
                <TableCell>{t('survey.fields.submitted_at')}</TableCell>
                <TableCell>{t('survey.responses.ip_address')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(responses ?? []).map((response) => (
                <TableRow key={response.id} hover>
                  <TableCell>{response.respondentEmail ?? t('survey.responses.anonymous')}</TableCell>
                  <TableCell>{formatDateTime(response.submittedAt, language)}</TableCell>
                  <TableCell>{response.ipAddress ?? '—'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setViewing(response.id)}>
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                    <Can permission="survey.responses.delete">
                      <IconButton size="small" onClick={() => setPendingDelete(response)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      {viewing ? (
        <ResponseDetailDialog surveyId={surveyId} responseId={viewing} questionTitleById={questionTitleById} onClose={() => setViewing(null)} />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('survey.responses.delete_title')}
        description={t('survey.responses.delete_confirm')}
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
