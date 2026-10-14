import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { changePassword } from '../../shared/api/auth';
import { extractErrorMessage } from '../../shared/api/httpClient';

/**
 * Self-service password change (`users.password.change_my`, route-gated in App.tsx).
 * The backend verifies the current password, applies the live password policy and
 * signs out the user's other sessions; this page only collects and shows the outcome.
 */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword !== confirmPassword) {
      setError(t('core.auth.passwords_do_not_match'));
      return;
    }
    setSubmitting(true);
    try {
      const { otherSessionsRevoked } = await changePassword(currentPassword, newPassword);
      setSuccess(otherSessionsRevoked > 0 ? t('core.changePassword.successOthers', { count: otherSessionsRevoked }) : t('core.changePassword.success'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.auth.change_password')}
      </Typography>
      <Box component="form" onSubmit={handleSubmit} noValidate sx={{ maxWidth: 420 }}>
        <Stack spacing={2}>
          <Alert severity="info">{t('core.changePassword.hint')}</Alert>
          {success ? <Alert severity="success">{success}</Alert> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label={t('core.changePassword.current')}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <TextField
            label={t('core.auth.new_password')}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <TextField
            label={t('core.auth.confirm_password')}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          <Box>
            <Button type="submit" variant="contained" disabled={submitting || !currentPassword || !newPassword || !confirmPassword}>
              {t('core.auth.change_password')}
            </Button>
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
