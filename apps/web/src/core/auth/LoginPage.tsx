import { Alert, Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import * as authApi from '../../shared/api/auth';
import { extractErrorMessage } from '../../shared/api/httpClient';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // D41 follow-up: the register link only appears once we know self-
  // registration is actually open — GET /auth/registration-status is
  // @Public() and purely a UX convenience; the real gate stays server-side
  // in POST /auth/register regardless of this. Defaults to hidden (not
  // shown) while loading/on error, same "fail closed" posture as the rest
  // of this page.
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    authApi
      .getRegistrationStatus()
      .then((status) => setRegistrationOpen(status.allowSelfRegistration))
      .catch(() => setRegistrationOpen(false));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 64px)' }}>
      <Card sx={{ width: 380 }}>
        <CardContent>
          <Typography variant="h5" component="h2" gutterBottom>
            {t('core.auth.login')}
          </Typography>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField
                label={t('core.auth.email')}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
                autoFocus
              />
              <TextField
                label={t('core.auth.password')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
              />
              <Button type="submit" variant="contained" size="large" disabled={submitting} fullWidth>
                {t('core.auth.login')}
              </Button>
              {registrationOpen ? (
                <Typography variant="body2" sx={{ textAlign: 'center' }}>
                  {t('core.auth.no_account_yet')}{' '}
                  <Link component={RouterLink} to="/register">
                    {t('core.auth.register')}
                  </Link>
                </Typography>
              ) : null}
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
