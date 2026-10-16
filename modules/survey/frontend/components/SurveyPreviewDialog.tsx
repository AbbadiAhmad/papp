import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FillableSurvey } from '../api';
import { SurveyRunner } from './SurveyRunner';

/**
 * Lets an owner try the survey exactly as a reader sees it, using the builder's
 * CURRENT (even unsaved) structure, at desktop or phone width. The same
 * `SurveyRunner` as the real page is used, but Submit only reports "preview
 * finished": nothing is sent, stored, or counted. Answers live in this
 * dialog's own state and vanish when it closes.
 */
export function SurveyPreviewDialog({ open, onClose, survey }: { open: boolean; onClose: () => void; survey: FillableSurvey | null }) {
  const { t } = useTranslation();
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [finished, setFinished] = useState(false);
  // Restart from a clean slate every time the dialog is opened.
  const [runKey, setRunKey] = useState(0);

  const restart = () => {
    setAnswers({});
    setFinished(false);
    setRunKey((k) => k + 1);
  };
  const close = () => {
    onClose();
    restart();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md" scroll="paper" aria-labelledby="preview-dialog-title">
      <DialogTitle id="preview-dialog-title">
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          {t('survey.builder.preview_title')}
          <ToggleButtonGroup size="small" exclusive value={width} onChange={(_, next) => next && setWidth(next)} aria-label={t('survey.builder.preview_width')}>
            <ToggleButton value="desktop">{t('survey.builder.preview_desktop')}</ToggleButton>
            <ToggleButton value="phone">{t('survey.builder.preview_phone')}</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'action.hover' }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('survey.builder.preview_note')}
        </Alert>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Paper
            elevation={3}
            sx={{ p: { xs: 2, sm: 4 }, width: '100%', maxWidth: width === 'phone' ? 375 : 640, transition: 'max-width .2s', ...(width === 'phone' ? { border: 6, borderColor: 'text.primary', borderRadius: 4 } : {}) }}
          >
            {survey ? (
              finished ? (
                <Stack spacing={2}>
                  <Alert severity="success">{t('survey.builder.preview_finished')}</Alert>
                  <Box>
                    <Button variant="outlined" onClick={restart}>
                      {t('survey.builder.preview_restart')}
                    </Button>
                  </Box>
                </Stack>
              ) : (
                <SurveyRunner
                  key={runKey}
                  survey={survey}
                  answers={answers}
                  onAnswerChange={(questionId, value) => setAnswers((prev) => ({ ...prev, [questionId]: value }))}
                  onSubmit={() => setFinished(true)}
                />
              )
            ) : null}
          </Paper>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('core.common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
