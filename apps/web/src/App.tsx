import { CssBaseline, ThemeProvider } from '@mui/material';
import { CacheProvider } from '@emotion/react';
import { Box, CircularProgress } from '@mui/material';
import { useMemo } from 'react';
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './app/AuthContext';
import { LanguageProvider, useLanguage } from './app/LanguageContext';
import { createAppTheme, createEmotionCacheFor } from './app/theme';
import { TopBar, PageLayout } from './shared/components/PageLayout';
import { PermissionGateProvider } from './shared/permissions';
import { LoginPage } from './core/auth/LoginPage';
import { ForcePasswordChangePage } from './core/auth/ForcePasswordChangePage';
import { DashboardPage } from './core/DashboardPage';
import { ForbiddenPage } from './core/ForbiddenPage';
import { NotFoundPage } from './core/NotFoundPage';
import { UsersListPage } from './core/users/UsersListPage';
import { UsersImportPage } from './core/users/UsersImportPage';
import { MyPreferencesPage } from './core/users/MyPreferencesPage';
import { useGuardedQuery } from './shared/hooks/useGuardedQuery';
import { usersApi } from './shared/api/users';
import { RolesListPage } from './core/roles/RolesListPage';
import { PermissionsMatrixPage } from './core/permissions/PermissionsMatrixPage';
import { SessionsPage } from './core/sessions/SessionsPage';
import { AuditPage } from './core/audit/AuditPage';
import { SettingsPage } from './core/settings/SettingsPage';
import { NotificationsInboxPage } from './core/notifications/NotificationsInboxPage';
import { NotificationsComposePage } from './core/notifications/NotificationsComposePage';
import { ModulesAdminPage } from './core/modules/ModulesAdminPage';
// Phase 8 — library_catalog module. No dynamic module-federation-style
// loading exists yet (Phase 6 didn't build one; BUILD_PLAN.md Phase 8's own
// note says a static addition to the route table is acceptable for now) —
// see modules/library_catalog/frontend/routes.tsx's own docblock.
import {
  AUTHENTICATED_LIBRARY_CATALOG_ROUTES,
  PUBLIC_LIBRARY_CATALOG_ROUTES,
} from '../../../modules/library_catalog/frontend/routes';
// library_circulation + library_finance module (D44) — same static-route-table pattern as library_catalog above.
import { AUTHENTICATED_LIBRARY_CIRCULATION_ROUTES } from '../../../modules/library_circulation/frontend/routes';
// Survey module — same static-route-table pattern as library_catalog above
// (no dynamic module-federation-style loading exists yet).
import { AUTHENTICATED_SURVEY_ROUTES, PUBLIC_SURVEY_ROUTES } from '../../../modules/survey/frontend/routes';
// Template module (docs/MODULE_SPEC.md §10) — the canonical scaffold, wired
// in exactly like every other module so it's a genuinely working example.
import { AUTHENTICATED_TEMPLATE_ROUTES, PUBLIC_TEMPLATE_ROUTES } from '../../../modules/template/frontend/routes';
// Website module — public site builder. Same static-route-table pattern as
// library_catalog above; PUBLIC_WEBSITE_ROUTES carries the visitor-facing
// `/site` + `/site/:slug` pages, reachable with no login at all.
import { AUTHENTICATED_WEBSITE_ROUTES, PUBLIC_WEBSITE_ROUTES } from '../../../modules/website/frontend/routes';

function FullScreenLoader() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 64px)' }}>
      <CircularProgress />
    </Box>
  );
}

/**
 * Feature: per-user default landing page. Renders at the authenticated root
 * `/` in place of the old hardcoded `<DashboardPage/>`. Falls back to
 * `DashboardPage` when the user has no preference set, AND when a
 * preference exists but no longer resolves (its module was uninstalled, or
 * the user lost the permission that used to grant it) — re-checked live
 * against `GET /users/me/landing-page-options`, the same authoritative list
 * `MyPreferencesPage` itself offers, rather than duplicating route/
 * permission knowledge here.
 */
function LandingPageRedirect() {
  const { user } = useAuth();
  const { status, data } = useGuardedQuery(null, () => usersApi.getMyLandingPageOptions());

  if (!user?.defaultLandingPage) {
    return <DashboardPage />;
  }
  if (status === 'loading') {
    return <FullScreenLoader />;
  }
  const stillValid = status === 'ready' && (data ?? []).some((option) => option.value === user.defaultLandingPage);
  if (!stillValid) {
    return <DashboardPage />;
  }
  return <Navigate to={user.defaultLandingPage} replace />;
}

/**
 * The three mutually-exclusive shells (ARCHITECTURE.md §6.1 / the
 * must-change-password flow): still resolving the silent-refresh-on-load
 * check; anonymous (only /login reachable); or authenticated. Every branch
 * still renders `<TopBar/>` (see App() below) so the brand bar is present
 * from the very first paint, before any network round-trip resolves.
 */
function AppRoutes() {
  const { status, mustChangePassword } = useAuth();

  if (status === 'initializing') {
    return <FullScreenLoader />;
  }

  if (status === 'anonymous') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* MODULE_SPEC.md §7.1: a public route "never redirects to the login
            page" — mounted here too so a shared link works for a visitor
            with no session at all, not just an authenticated one. */}
        {PUBLIC_LIBRARY_CATALOG_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_SURVEY_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_TEMPLATE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_WEBSITE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (mustChangePassword) {
    return (
      <Routes>
        <Route path="/force-password-change" element={<ForcePasswordChangePage />} />
        {PUBLIC_LIBRARY_CATALOG_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_SURVEY_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_TEMPLATE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_WEBSITE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        <Route path="*" element={<Navigate to="/force-password-change" replace />} />
      </Routes>
    );
  }

  return (
    <PageLayout>
      <Routes>
        <Route path="/" element={<LandingPageRedirect />} />
        <Route path="/my-preferences" element={<MyPreferencesPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/force-password-change" element={<Navigate to="/" replace />} />
        <Route path="/users" element={<UsersListPage />} />
        <Route path="/users/import" element={<UsersImportPage />} />
        <Route path="/roles" element={<RolesListPage />} />
        {/* D12 (ARCHITECTURE.md §7.4): reachable by any authenticated user,
            no client-side pre-check — the page's own real calls decide what
            it can show (see PermissionsMatrixPage's docblock). */}
        <Route path="/permissions" element={<PermissionsMatrixPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/notifications" element={<NotificationsInboxPage />} />
        <Route path="/notifications/compose" element={<NotificationsComposePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/modules" element={<ModulesAdminPage />} />
        {/* Phase 8 — library_catalog module routes. */}
        {AUTHENTICATED_LIBRARY_CATALOG_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_LIBRARY_CATALOG_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {/* library_circulation + library_finance module (D44) — no public routes. */}
        {AUTHENTICATED_LIBRARY_CIRCULATION_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {/* Survey module — AUTHENTICATED_SURVEY_ROUTES first so PageLayout's
            menu-driven admin pages are always reachable; PUBLIC_SURVEY_ROUTES
            too, so the same shareable /survey/:surveyId link also works for
            an already-logged-in visitor, inside the app shell. */}
        {AUTHENTICATED_SURVEY_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_SURVEY_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {/* Template module — same authenticated-then-public pairing as survey above. */}
        {AUTHENTICATED_TEMPLATE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_TEMPLATE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {/* Website module — same authenticated-then-public pairing as survey above. */}
        {AUTHENTICATED_WEBSITE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {PUBLIC_WEBSITE_ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </PageLayout>
  );
}

function ThemedShell() {
  const { direction } = useLanguage();
  const cache = useMemo(() => createEmotionCacheFor(direction), [direction]);
  const theme = useMemo(() => createAppTheme(direction), [direction]);

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <AuthProvider>
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
              <TopBar />
              <AppRoutes />
            </Box>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </CacheProvider>
  );
}

/**
 * Root shell (docs/BUILD_PLAN.md Phase 6 item 1): React Router, MUI
 * `ThemeProvider` with `direction` driven by the active language,
 * `react-i18next` bootstrap, and the auth/session context. Provider order
 * matters: `PermissionGateProvider` must wrap `AuthProvider` (it resets the
 * gate on login/logout — see AuthContext.tsx), and `LanguageProvider` must
 * wrap `ThemedShell` (the theme/emotion cache are derived from its
 * direction).
 */
function App() {
  return (
    <PermissionGateProvider>
      <LanguageProvider>
        <ThemedShell />
      </LanguageProvider>
    </PermissionGateProvider>
  );
}

export default App;
