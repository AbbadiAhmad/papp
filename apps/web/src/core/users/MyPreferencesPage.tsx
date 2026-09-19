import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../app/AuthContext';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { usersApi } from '../../shared/api/users';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import type { LandingPageOption } from '../../shared/api/types';

/**
 * Self-scoped "my account" preferences page — the first of its kind
 * (previously there was no self-service settings surface at all, only the
 * admin-only `/settings` screen). Backed entirely by the self-scoped
 * `GET/PATCH /users/me/landing-page*` endpoints, gated with `permissionCode:
 * null` exactly like `GET /me` itself — every role can reach this page.
 */
export function MyPreferencesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { status, data, errorMessage, reload } = useGuardedQuery(() => usersApi.getMyLandingPageOptions());

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.myPreferences')}
      </Typography>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {data && user ? <LandingPageForm options={data} initial={user.defaultLandingPage} /> : null}
      </QueryStateGate>
    </Box>
  );
}

function LandingPageForm({ options, initial }: { options: LandingPageOption[]; initial: string | null }) {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  // `null` doesn't serialize cleanly as a <TextField select> value — the
  // platform-default option uses this literal string as its sentinel and is
  // translated back to `null` only when actually sending the PATCH.
  const PLATFORM_DEFAULT_SENTINEL = '__platform_default__';
  const [value, setValue] = useState(initial ?? PLATFORM_DEFAULT_SENTINEL);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const landingPage = value === PLATFORM_DEFAULT_SENTINEL ? null : value;
      await usersApi.setMyLandingPage(landingPage);
      await refreshUser();
      setSaved(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 420 }}>
      {saved ? <Alert severity="success">{t('core.settings.saved')}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        select
        label={t('core.myPreferences.landingPage')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        {options.map((option) => (
          <MenuItem key={option.value ?? PLATFORM_DEFAULT_SENTINEL} value={option.value ?? PLATFORM_DEFAULT_SENTINEL}>
            {t(option.labelKey)}
          </MenuItem>
        ))}
      </TextField>
      <Box>
        <Button variant="contained" onClick={save}>
          {t('core.common.save')}
        </Button>
      </Box>
    </Stack>
  );
}
