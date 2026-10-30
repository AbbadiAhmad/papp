import { Alert, Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import * as authApi from '../../shared/api/auth';
import { extractErrorMessage } from '../../shared/api/httpClient';

/** The page the emailed link opens: `/reset-password?token=...`. The token is the credential. */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t('core.auth.passwords_do_not_match'));
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 64px)', px: 2, py: 4 }}>
      <Card sx={{ width: '100%', maxWidth: 400, boxShadow: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h5" component="h2" gutterBottom>
            {t('core.auth.reset_password_title')}
          </Typography>
          {!token ? (
            <Stack spacing={2}>
              <Alert severity="error">{t('core.auth.reset_password_no_token')}</Alert>
              <Link component={RouterLink} to="/forgot-password">
                {t('core.auth.forgot_password_title')}
              </Link>
            </Stack>
          ) : done ? (
            <Stack spacing={2}>
              <Alert severity="success">{t('core.auth.reset_password_done')}</Alert>
              <Button component={RouterLink} to="/login" variant="contained">
                {t('core.auth.login')}
              </Button>
            </Stack>
          ) : (
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <Stack spacing={2}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField label={t('core.auth.new_password')} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required fullWidth autoFocus />
                <TextField label={t('core.auth.confirm_password')} type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required fullWidth />
                <Button type="submit" variant="contained" size="large" disabled={submitting || !newPassword} fullWidth>
                  {t('core.auth.reset_password_submit')}
                </Button>
                {error ? (
                  <Link component={RouterLink} to="/forgot-password" sx={{ textAlign: 'center' }}>
                    {t('core.auth.forgot_password_title')}
                  </Link>
                ) : null}
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
