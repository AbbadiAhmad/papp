import { Box, CircularProgress } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermission, usePermissionsLoaded } from '../permissions';

/**
 * Route-level permission guard: wraps a page element so an unauthorized
 * user never sees so much as a flash of it. Renders a loader while the
 * real permission set (`AuthContext`'s `GET /users/me/permissions`) is
 * still loading, `<Navigate to="/forbidden">` once loaded and denied, or
 * the wrapped page once loaded and allowed. `code={null}` means "no
 * specific grant needed, logged in is enough" — the same category as
 * `GET /users/me` — and always renders the page once permissions have
 * loaded (never denies).
 *
 * This is what actually fixes the old "page renders, its own data call
 * 403s, THEN it redirects" flash — the sidebar (`PageLayout.tsx`) already
 * hides an ungranted item from view, but a user could still reach the URL
 * directly (bookmark, typed URL, stale link); this guard is what makes
 * that path behave identically to never having navigated there at all.
 */
export function RequirePermissionRoute({ code, children }: { code: string | null; children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const loaded = usePermissionsLoaded();
  const allowed = usePermission(code ?? '__always__');

  if (!loaded) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress aria-label={t('core.common.loading')} />
      </Box>
    );
  }

  if (code && !allowed) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
