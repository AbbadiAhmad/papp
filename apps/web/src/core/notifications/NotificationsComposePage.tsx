import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { notificationsApi, type SendNotificationInput } from '../../shared/api/notifications';
import { useGatedCall } from '../../shared/permissions';
import type { NotificationTargetType } from '../../shared/api/types';

export function NotificationsComposePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gated = useGatedCall();

  const [category, setCategory] = useState('system.announcement');
  const [title, setTitle] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [targetType, setTargetType] = useState<NotificationTargetType>('all_users');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const dto: SendNotificationInput = {
        category,
        title,
        bodyMarkdown,
        targetType,
        targetId: targetType === 'all_users' ? undefined : targetId,
      };
      const result = await gated('notifications.send', () => notificationsApi.send(dto));
      setSuccess(t('core.notifications.sent', { recipients: result.recipientCount }));
      setTitle('');
      setBodyMarkdown('');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 560 }}>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.notifications.compose')}
      </Typography>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {success ? <Alert severity="success">{success}</Alert> : null}
          <TextField label={t('core.notifications.category')} value={category} onChange={(e) => setCategory(e.target.value)} required fullWidth />
          <TextField label={t('core.notifications.title')} value={title} onChange={(e) => setTitle(e.target.value)} required fullWidth />
          <TextField
            label={t('core.notifications.body')}
            value={bodyMarkdown}
            onChange={(e) => setBodyMarkdown(e.target.value)}
            required
            fullWidth
            multiline
            minRows={4}
          />
          <TextField
            select
            label={t('core.notifications.target_type')}
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as NotificationTargetType)}
            fullWidth
          >
            <MenuItem value="all_users">{t('core.notifications.target_all_users')}</MenuItem>
            <MenuItem value="role">{t('core.notifications.target_role')}</MenuItem>
            <MenuItem value="user">{t('core.notifications.target_user')}</MenuItem>
          </TextField>
          {targetType !== 'all_users' ? (
            <TextField
              label={targetType === 'role' ? t('core.notifications.role_id') : t('core.notifications.user_id')}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              required
              fullWidth
            />
          ) : null}
          <Stack direction="row" spacing={2}>
            <Button type="submit" variant="contained" disabled={submitting}>
              {t('core.notifications.send')}
            </Button>
            <Button onClick={() => navigate('/notifications')}>{t('core.common.cancel')}</Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
