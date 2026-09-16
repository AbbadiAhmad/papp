import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { GuardedQueryStatus } from '../hooks/useGuardedQuery';

/**
 * Renders the right thing for each `useGuardedQuery` status. `forbidden`
 * performs a REAL client-side redirect to `/forbidden` (react-router
 * `<Navigate>`) — this is what "a reader can't reach an admin-only page even
 * by typing the URL directly" means on the frontend: the page's own real
 * data call 403s, and ONLY THEN does the app navigate away. It is never a
 * pre-emptive guess before the call is made.
 */
export function QueryStateGate({
  status,
  errorMessage,
  onRetry,
  children,
}: {
  status: GuardedQueryStatus;
  errorMessage?: string | null;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress aria-label={t('core.common.loading')} />
      </Box>
    );
  }

  if (status === 'forbidden') {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />;
  }

  if (status === 'error') {
    return (
      <Stack spacing={2} sx={{ p: 3 }}>
        <Alert severity="error">{errorMessage ?? t('core.common.error')}</Alert>
        {onRetry ? (
          <Box>
            <Button variant="outlined" onClick={onRetry}>
              {t('core.common.retry')}
            </Button>
          </Box>
        ) : null}
      </Stack>
    );
  }

  return <>{children}</>;
}

export function InlineForbiddenNotice({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <Alert severity="warning" sx={{ mt: 2 }}>
      <Typography variant="body2">{t('core.common.action_forbidden', { code })}</Typography>
    </Alert>
  );
}
