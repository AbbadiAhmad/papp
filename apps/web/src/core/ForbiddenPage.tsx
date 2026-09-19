import { Alert, Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

/**
 * Landed on via one of two paths, both of which are real, never a guess:
 *  - The common path: `RequirePermissionRoute` (`shared/components/
 *    RequirePermissionRoute.tsx`) checks the caller's REAL effective
 *    permissions (`AuthContext`'s `GET /users/me/permissions`) before the
 *    target page ever mounts — an unauthorized user never sees so much as
 *    a flash of the page.
 *  - The safety-net path: a page's own data call still 403s anyway (e.g.
 *    client-side permission state is momentarily stale — a grant was
 *    revoked mid-session before the next refresh) — `QueryStateGate`
 *    catches that live rejection and redirects here the same way.
 * Either way, the backend `PermissionGuard` is the actual boundary; this
 * page is only ever reached after a real check said no.
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
