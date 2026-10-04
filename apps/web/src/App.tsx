import { CssBaseline, ThemeProvider } from '@mui/material';
import { CacheProvider } from '@emotion/react';
import { Box, CircularProgress } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './app/AuthContext';
import { LanguageProvider, useLanguage } from './app/LanguageContext';
import { createAppTheme, createEmotionCacheFor } from './app/theme';
import { TopBar, PageLayout, MobileNavProvider } from './shared/components/PageLayout';
import { RequirePermissionRoute } from './shared/components/RequirePermissionRoute';
import * as authApi from './shared/api/auth';
import { LoginPage } from './core/auth/LoginPage';
import { RegisterPage } from './core/auth/RegisterPage';
import { SetupPage } from './core/auth/SetupPage';
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
import { MyPermissionsPage } from './core/permissions/MyPermissionsPage';
import { SessionsPage } from './core/sessions/SessionsPage';
import { AuditPage } from './core/audit/AuditPage';
import { BackupPage } from './core/backup/BackupPage';
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
  const { status, data } = useGuardedQuery(() => usersApi.getMyLandingPageOptions());

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
 * Root D60/A27 (UI-wizard option): whether a fresh install still needs its
 * first admin account, per `GET /auth/setup-status` (`@Public()`). Checked
 * ONLY while anonymous — an authenticated session already proves setup is
 * done, so this never runs in the authenticated/must-change-password
 * branches. `null` while loading (never defaults to `false`), so the
 * anonymous branch below can show a loader instead of flashing LoginPage
 * before redirecting to SetupPage on a genuinely fresh install.
 */
function useSetupNeeded(shouldCheck: boolean): { loading: boolean; setupNeeded: boolean; markSetupComplete: () => void } {
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!shouldCheck) return;
    authApi
      .getSetupStatus()
      .then((result) => setSetupNeeded(result.setupNeeded))
      // A transient failure (network hiccup, api not up yet) is treated as
      // "no setup needed" rather than getting stuck — the normal login flow
      // then surfaces the real error if the api is genuinely unreachable.
      .catch(() => setSetupNeeded(false));
  }, [shouldCheck]);

  const markSetupComplete = useCallback(() => setSetupNeeded(false), []);

  return { loading: shouldCheck && setupNeeded === null, setupNeeded: setupNeeded ?? false, markSetupComplete };
}

/**
 * The three mutually-exclusive shells (ARCHITECTURE.md §6.1 / the
 * must-change-password flow): still resolving the silent-refresh-on-load
 * check; anonymous (only /login reachable, or /setup on a fresh install);
 * or authenticated. Every branch still renders `<TopBar/>` (see App() below)
 * so the brand bar is present from the very first paint, before any network
 * round-trip resolves.
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
  const { loading: setupStatusLoading, setupNeeded, markSetupComplete } = useSetupNeeded(status === 'anonymous');

  if (status === 'initializing') {
    return <FullScreenLoader />;
  }

  if (status === 'anonymous') {
    if (setupStatusLoading) {
      return <FullScreenLoader />;
    }
    if (setupNeeded) {
      // No `<Route>` needed: a fresh install has no session and no other
      // reachable page yet, so this IS the whole anonymous shell until an
      // admin account exists. `markSetupComplete` flips local state so the
      // very next render falls through to the normal LoginPage branch below
      // — no page reload, no re-fetch of setup-status.
      return (
        <Routes>
          <Route path="*" element={<SetupPage onSetupComplete={markSetupComplete} />} />
        </Routes>
      );
    }
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* D41 follow-up: reachable regardless of the admin toggle — same
            "frontend never trusts its own status check" posture as
            /setup-status above; POST /auth/register re-checks the real
            setting itself and 403s if it's off, surfaced via RegisterPage's
            own error state. */}
        <Route path="/register" element={<RegisterPage />} />
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
        <Route path="/register" element={<Navigate to="/" replace />} />
        <Route path="/force-password-change" element={<Navigate to="/" replace />} />
        <Route
          path="/users"
          element={
            <RequirePermissionRoute code="users.view">
              <UsersListPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/users/import"
          element={
            <RequirePermissionRoute code="users.import">
              <UsersImportPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/roles"
          element={
            <RequirePermissionRoute code="roles.view">
              <RolesListPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/permissions"
          element={
            <RequirePermissionRoute code="permissions.view">
              <PermissionsMatrixPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/sessions"
          element={
            <RequirePermissionRoute code="sessions.view_my">
              <SessionsPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/my-permissions"
          element={
            <RequirePermissionRoute code="permissions.view_my">
              <MyPermissionsPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <RequirePermissionRoute code="audit.view">
              <AuditPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/backup"
          element={
            <RequirePermissionRoute code="backup.export">
              <BackupPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <RequirePermissionRoute code="notifications.view">
              <NotificationsInboxPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/notifications/compose"
          element={
            <RequirePermissionRoute code="notifications.send">
              <NotificationsComposePage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <RequirePermissionRoute code="users.settings.view">
              <SettingsPage />
            </RequirePermissionRoute>
          }
        />
        <Route
          path="/modules"
          element={
            <RequirePermissionRoute code="modules.view">
              <ModulesAdminPage />
            </RequirePermissionRoute>
          }
        />
        {/* Every installed module's own routes (root DECISIONS.md D78) —
            each already wrapped in its own RequirePermissionRoute by
            useAuthenticatedModuleRoutes, matched against that module's
            manifest — see this function's own docblock. */}
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
            <MobileNavProvider>
              <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                <TopBar />
                <AppRoutes />
              </Box>
            </MobileNavProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </CacheProvider>
  );
}

/**
 * Root shell (docs/BUILD_PLAN.md Phase 6 item 1): React Router, MUI
 * `ThemeProvider` with `direction` driven by the active language,
 * `react-i18next` bootstrap, and the auth/session context. Real permission
 * state now lives entirely inside `AuthProvider` (`GET
 * /users/me/permissions`, fetched alongside `GET /users/me`) — no separate
 * permission-gate provider is needed any more (superseded the old
 * `PermissionGateProvider`, which existed only to cache/reset "confirmed
 * denied by a real 403" codes across login/logout; `AuthProvider` already
 * resets its own `permissions` state on logout/auth-expiry).
 */
function App() {
  return (
    <LanguageProvider>
      <ThemedShell />
    </LanguageProvider>
  );
}

export default App;
