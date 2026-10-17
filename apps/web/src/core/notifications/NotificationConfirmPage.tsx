import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useLanguage } from '../../app/LanguageContext';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { notificationsApi, type ConfirmationPreview } from '../../shared/api/notifications';
import { formatDateTime } from '../../shared/format';

/**
 * Public page opened from the emailed confirmation link (D119). No login: the
 * unguessable token in the URL is the credential. Shows the exact text being
 * confirmed, an optional comment box, and — once confirmed — the receipt.
 */
export function NotificationConfirmPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { token = '' } = useParams();
  const [preview, setPreview] = useState<ConfirmationPreview | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    notificationsApi
      .previewConfirmation(token)
      .then((p) => {
        setPreview(p);
        setConfirmedAt(p.confirmedAt);
      })
      .catch((err) => {
        if (axios.isAxiosError(err) && err.response?.status === 404) setNotFound(true);
        else setError(extractErrorMessage(err));
      });
  }, [token]);

  const handleConfirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await notificationsApi.confirm(token, comment);
      setConfirmedAt(result.confirmedAt);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        // Confirmed in another tab/click: show the receipt.
        const refreshed = await notificationsApi.previewConfirmation(token);
        setConfirmedAt(refreshed.confirmedAt);
      } else {
        setError(extractErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', p: 2 }}>
      {notFound ? <Alert severity="error">{t('core.notifications.confirm.not_found')}</Alert> : null}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {!preview && !notFound && !error ? <CircularProgress /> : null}
      {preview ? (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h5" component="h1">
                {preview.title}
              </Typography>
              <Typography
                variant="body1"
                // Server-rendered, sanitized HTML (same as the inbox).
                dangerouslySetInnerHTML={{ __html: preview.bodyHtml }}
              />
              {confirmedAt ? (
                <Alert icon={<CheckCircleOutlineIcon />} severity="success">
                  {t('core.notifications.confirm.done')}{' '}
                  {t('core.notifications.confirm.done_at', { when: formatDateTime(confirmedAt, language) })}
                </Alert>
              ) : preview.expired ? (
                <Alert severity="warning">{t('core.notifications.confirm.expired')}</Alert>
              ) : (
                <>
                  {preview.allowComment ? (
                    <TextField
                      label={t('core.notifications.confirm.comment')}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      multiline
                      minRows={2}
                      fullWidth
                      slotProps={{ htmlInput: { maxLength: 2000 } }}
                    />
                  ) : null}
                  <Typography variant="caption" color="text.secondary">
                    {t('core.notifications.confirm.notice')}
                  </Typography>
                  <Button variant="contained" onClick={handleConfirm} disabled={submitting}>
                    {t('core.notifications.confirm.submit')}
                  </Button>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
      ) : null}
    </Box>
  );
}
