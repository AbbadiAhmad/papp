import { Alert, Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

/**
 * Landed on after a page's OWN real API call came back 403 (see
 * `shared/components/QueryStateGate.tsx`) — never a pre-emptive guess. This
 * is what proves "a reader can't reach an admin/finance-only page even by
 * typing the URL directly": the route renders, the page's real GET runs,
 * the backend PermissionGuard rejects it, and only then does the SPA
 * navigate here.
 */
export function ForbiddenPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8 }}>
      <Alert severity="error">
        <Typography variant="h6" component="h2" gutterBottom>
          {t('core.forbidden.title')}
        </Typography>
        <Typography variant="body2">{t('core.forbidden.body')}</Typography>
        {from ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {from}
          </Typography>
        ) : null}
      </Alert>
    </Box>
  );
}
