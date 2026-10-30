import { Alert, Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import * as authApi from '../../shared/api/auth';
import { extractErrorMessage } from '../../shared/api/httpClient';

/** Asks for the account's email; the answer is the same whether or not an account exists. */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
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
            {t('core.auth.forgot_password_title')}
          </Typography>
          {sent ? (
            <Stack spacing={2}>
              <Alert severity="success">{t('core.auth.forgot_password_sent')}</Alert>
              <Link component={RouterLink} to="/login">
                {t('core.auth.back_to_login')}
              </Link>
            </Stack>
          ) : (
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {t('core.auth.forgot_password_help')}
                </Typography>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField label={t('core.auth.email')} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth autoFocus />
                <Button type="submit" variant="contained" size="large" disabled={submitting || !email.trim()} fullWidth>
                  {t('core.auth.forgot_password_send')}
                </Button>
                <Link component={RouterLink} to="/login" sx={{ textAlign: 'center' }}>
                  {t('core.auth.back_to_login')}
                </Link>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
