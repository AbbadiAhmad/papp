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
import {
  useAuthenticatedModuleRoutes,
  useModuleFrontendManifests,
  usePublicModuleRoutes,
} from './shared/modules/useInstalledModules';

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
 *
 * Module routes (root DECISIONS.md D78/D79) are resolved ONCE here, before
 * any branch — these are hooks and must not be called conditionally — then
 * spread into whichever branch actually renders below. Nothing here imports
 * a module by name. `publicModuleRoutes` needs no network call at all (every
 * discovered module's public routes mount unconditionally — a public
 * route's own API already 404s gracefully if that module isn't installed,
 * so there's nothing to gain, and real information to lose, from asking an
 * anonymous-reachable endpoint which modules exist just to decide this).
 * `authenticatedModuleRoutes` DOES need the real installed-module list —
 * fetched only once actually authenticated (root D79: the backend endpoint
 * requires a session, unlike D78's original `@Public()` choice), from
 * `GET /modules/frontend-manifest` cross-referenced against whatever
 * `modules/*\/frontend/routes.tsx` files Vite discovered at build time
 * (`shared/modules/discovery.ts`). Adding or removing a module changes
 * NEITHER array's construction — only what ends up in them at runtime.
 */
function AppRoutes() {
  const { status, mustChangePassword } = useAuth();
  const moduleManifests = useModuleFrontendManifests(status === 'authenticated' && !mustChangePassword);
  const authenticatedModuleRoutes = useAuthenticatedModuleRoutes(moduleManifests);
  const publicModuleRoutes = usePublicModuleRoutes();

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
        {publicModuleRoutes.map((route) => (
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
        {publicModuleRoutes.map((route) => (
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
        {/* Every installed module's own routes (root DECISIONS.md D78) — see
            this function's own docblock. */}
        {authenticatedModuleRoutes.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        {publicModuleRoutes.map((route) => (
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
