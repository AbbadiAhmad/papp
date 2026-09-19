import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as authApi from '../../shared/api/auth';
import { extractErrorMessage } from '../../shared/api/httpClient';

interface SetupPageProps {
  /** Called after the first admin account is created, so the caller can re-check /auth/setup-status and switch to LoginPage. */
  onSetupComplete: () => void;
}

/**
 * Root D60/A27 (UI-wizard option): shown instead of LoginPage when
 * `GET /auth/setup-status` reports `setupNeeded: true` (an empty `users`
 * table — a fresh install). Deliberately does NOT auto-login after creating
 * the account — same as self-registration (RegisterDto) — the new admin
 * logs in separately via the normal LoginPage right after.
 */
export function SetupPage({ onSetupComplete }: SetupPageProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('core.auth.passwords_do_not_match'));
      return;
    }

    setSubmitting(true);
    try {
      await authApi.createFirstAdmin(email, name, password);
      setSuccess(true);
      onSetupComplete();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 64px)' }}>
      <Card sx={{ width: 420 }}>
        <CardContent>
          <Typography variant="h5" component="h2" gutterBottom>
            {t('core.auth.setup_title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('core.auth.setup_hint')}
          </Typography>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              {success ? <Alert severity="success">{t('core.auth.setup_success')}</Alert> : null}
              <TextField
                label={t('core.auth.name')}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                fullWidth
                autoFocus
                disabled={success}
              />
              <TextField
                label={t('core.auth.email')}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
                disabled={success}
              />
              <TextField
                label={t('core.auth.password')}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
                disabled={success}
              />
              <TextField
                label={t('core.auth.confirm_password')}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                fullWidth
                disabled={success}
              />
              <Button type="submit" variant="contained" size="large" disabled={submitting || success} fullWidth>
                {t('core.auth.setup_submit')}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
