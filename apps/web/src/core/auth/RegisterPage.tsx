import { Alert, Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import * as authApi from '../../shared/api/auth';
import { extractErrorMessage } from '../../shared/api/httpClient';

/**
 * D41 self-registration's frontend half — the backend (`POST /auth/register`)
 * and its admin toggle (`users.allow_self_registration`, Settings page) have
 * existed since Phase 5, but no page/route/link ever shipped for it, so
 * turning the toggle on left no way to actually reach it. Reachable at
 * `/register`, linked from `LoginPage`.
 *
 * Deliberately does NOT auto-login after creating the account — same as
 * `SetupPage` (D80) and `register()`'s own contract (BUILD_PLAN.md Phase 5:
 * "does not auto-login (201, no tokens)"). The role assigned to the new
 * account is whatever the admin configured in Settings → Self-Registration
 * (D91 — never a hardcoded role, since papp is a general back-office
 * platform, not Library-specific); there is no role picker here, by design.
 */
export function RegisterPage() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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
      await authApi.register(email, name, password);
      setSuccess(true);
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
            {t('core.auth.register_title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('core.auth.register_hint')}
          </Typography>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              {success ? <Alert severity="success">{t('core.auth.register_success')}</Alert> : null}
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
                {t('core.auth.register_submit')}
              </Button>
              <Typography variant="body2" sx={{ textAlign: 'center' }}>
                <Link component={RouterLink} to="/login">
                  {t('core.auth.back_to_login')}
                </Link>
              </Typography>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
