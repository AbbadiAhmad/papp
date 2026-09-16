import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../app/AuthContext';
import { extractErrorMessage } from '../../shared/api/httpClient';

/**
 * Shown whenever `useAuth().mustChangePassword` is true — mirrored from
 * `PublicUser.mustChangePassword` (see users.controller.ts's `GET /users/me`)
 * rather than sniffing MustChangePasswordGuard's 403 shape up front: the
 * guard only fires once the user tries ANOTHER endpoint, whereas `/users/me`
 * tells the app immediately after login, before any such 403 happens.
 */
export function ForcePasswordChangePage() {
  const { t } = useTranslation();
  const { completeForcePasswordChange } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
      await completeForcePasswordChange(newPassword);
      // AuthContext re-fetches /users/me — mustChangePassword flips to
      // false, and AppRoutes naturally shows the authenticated shell next.
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 64px)' }}>
      <Card sx={{ width: 400 }}>
        <CardContent>
          <Typography variant="h5" component="h2" gutterBottom>
            {t('core.auth.change_password')}
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('core.auth.must_change_password')}
          </Alert>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField
                label={t('core.auth.new_password')}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                fullWidth
                autoFocus
              />
              <TextField
                label={t('core.auth.confirm_password')}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                fullWidth
              />
              <Button type="submit" variant="contained" size="large" disabled={submitting} fullWidth>
                {t('core.common.save')}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
