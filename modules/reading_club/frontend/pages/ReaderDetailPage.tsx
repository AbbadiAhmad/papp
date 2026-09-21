import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
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
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can } from '../../../../apps/web/src/shared/permissions';
import { readingClubApi } from '../api';
import { AssignReaderDialog } from './AssignReaderDialog';

/** A reader's reading-club profile: current group/stage, live progress, action buttons, and the append-only stage-completion/reward history. */
export function ReaderDetailPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { studentId } = useParams<{ studentId: string }>();
  const { status, data: reader, errorMessage, reload } = useGuardedQuery(() => readingClubApi.getReader(studentId!));

  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [moveStageOpen, setMoveStageOpen] = useState(false);
  const [targetStageId, setTargetStageId] = useState('');
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressValue, setProgressValue] = useState(0);
  const [busy, setBusy] = useState(false);

  const handleMarkComplete = async () => {
    if (!studentId) return;
    setBusy(true);
    try {
      await readingClubApi.completeStage(studentId);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReward = async (completionId: string) => {
    setBusy(true);
    try {
      await readingClubApi.confirmReward(completionId);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openMoveStage = () => {
    setTargetStageId('');
    setMoveStageOpen(true);
  };
  const handleMoveStage = async () => {
    if (!studentId || !targetStageId) return;
    setBusy(true);
    try {
      await readingClubApi.moveStage(studentId, targetStageId);
      setMoveStageOpen(false);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openProgress = () => {
    setProgressValue(reader?.membership?.manualProgressAmount ?? 0);
    setProgressOpen(true);
  };
  const handleUpdateProgress = async () => {
    if (!studentId) return;
    setBusy(true);
    try {
      await readingClubApi.updateProgress(studentId, progressValue);
      setProgressOpen(false);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {reader ? (
          <Stack spacing={2}>
            <Card>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
                  <Stack spacing={0.5}>
                    <Typography variant="h5">{reader.studentName ?? reader.studentCode}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('library_circulation.students.code')}: {reader.studentCode}
                      {reader.className ? ` · ${reader.className}` : ''}
                    </Typography>
                  </Stack>
                  <Can permission="reading_club.memberships.assign">
                    <Button variant="outlined" onClick={() => setAssignOpen(true)}>
                      {reader.group ? t('reading_club.readers.move_group_button') : t('reading_club.readers.assign_button')}
                    </Button>
                  </Can>
                </Stack>
              </CardContent>
            </Card>

            {reader.group && reader.stage ? (
              <Card>
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                    <Stack spacing={0.5}>
                      <Typography variant="overline" color="text.secondary">
                        {reader.group.name}
                      </Typography>
                      <Typography variant="h6">
                        {reader.stage.stageOrder}. {reader.stage.name}
                      </Typography>
                      {reader.stage.rewardDescription ? (
                        <Chip size="small" label={`${t('reading_club.fields.reward_description')}: ${reader.stage.rewardDescription}`} />
                      ) : null}
                    </Stack>
                    <Can permission="reading_club.memberships.assign">
                      <Button size="small" onClick={openMoveStage}>
                        {t('reading_club.readers.move_stage_button')}
                      </Button>
                    </Can>
                  </Stack>

                  {reader.progress ? (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="body2">
                        {reader.progress.progressAmount} / {reader.progress.targetAmount} {t(`reading_club.target_type.${reader.progress.targetType}`)}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, (reader.progress.progressAmount / reader.progress.targetAmount) * 100)}
                        color={reader.progress.isComplete ? 'success' : 'primary'}
                      />
                    </Box>
                  ) : null}

                  <Stack direction="row" spacing={2} sx={{ mt: 2, flexWrap: 'wrap' }}>
                    {reader.stage.targetType === 'pages' ? (
                      <Can permission="reading_club.memberships.update_progress">
                        <Button variant="outlined" onClick={openProgress}>
                          {t('reading_club.readers.update_progress_button')}
                        </Button>
                      </Can>
                    ) : null}
                    <Can permission="reading_club.stage_completions.mark">
                      <Button variant="contained" onClick={handleMarkComplete} disabled={busy}>
                        {t('reading_club.readers.mark_complete_button')}
                      </Button>
                    </Can>
                  </Stack>
                </CardContent>
              </Card>
            ) : reader.group ? (
              <Alert severity="info">{t('reading_club.readers.group_finished')}</Alert>
            ) : (
              <Alert severity="warning">{t('reading_club.readers.not_assigned')}</Alert>
            )}

            <Paper>
              <Box sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  {t('reading_club.readers.history_heading')}
                </Typography>
                {reader.completions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {t('core.common.no_data')}
                  </Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('reading_club.readers.completed_at')}</TableCell>
                          <TableCell>{t('reading_club.readers.reward_status')}</TableCell>
                          <TableCell align="right">{t('core.common.actions')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {reader.completions.map((completion) => (
                          <TableRow key={completion.id}>
                            <TableCell>{formatDateOnly(completion.completedAt, language)}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={t(`reading_club.reward_status.${completion.rewardStatus}`)}
                                color={completion.rewardStatus === 'delivered' ? 'success' : 'warning'}
                              />
                            </TableCell>
                            <TableCell align="right">
                              {completion.rewardStatus === 'pending' ? (
                                <Can permission="reading_club.stage_completions.confirm_reward">
                                  <Button size="small" onClick={() => handleConfirmReward(completion.id)} disabled={busy}>
                                    {t('reading_club.readers.confirm_reward_button')}
                                  </Button>
                                </Can>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>
            </Paper>
          </Stack>
        ) : null}
      </QueryStateGate>

      <AssignReaderDialog open={assignOpen} onClose={() => setAssignOpen(false)} onAssigned={reload} />

      <Dialog open={moveStageOpen} onClose={() => setMoveStageOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('reading_club.readers.move_stage_button')}</DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            label={t('reading_club.readers.current_stage')}
            value={targetStageId}
            onChange={(e) => setTargetStageId(e.target.value)}
            sx={{ mt: 1 }}
          >
            {(reader?.group?.stages ?? [])
              .slice()
              .sort((a, b) => a.stageOrder - b.stageOrder)
              .map((stage) => (
                <MenuItem key={stage.id} value={stage.id}>
                  {stage.stageOrder}. {stage.name}
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveStageOpen(false)}>{t('core.common.cancel')}</Button>
          <Button variant="contained" onClick={handleMoveStage} disabled={!targetStageId || busy}>
            {t('core.common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={progressOpen} onClose={() => setProgressOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('reading_club.readers.update_progress_button')}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            type="number"
            label={t('reading_club.fields.target_amount')}
            value={progressValue}
            onChange={(e) => setProgressValue(Number(e.target.value))}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProgressOpen(false)}>{t('core.common.cancel')}</Button>
          <Button variant="contained" onClick={handleUpdateProgress} disabled={busy}>
            {t('core.common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
