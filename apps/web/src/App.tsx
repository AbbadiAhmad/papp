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
import { RolesListPage } from './core/roles/RolesListPage';
import { PermissionsMatrixPage } from './core/permissions/PermissionsMatrixPage';
import { SessionsPage } from './core/sessions/SessionsPage';
import { AuditPage } from './core/audit/AuditPage';
import { SettingsPage } from './core/settings/SettingsPage';
import { NotificationsInboxPage } from './core/notifications/NotificationsInboxPage';
import { NotificationsComposePage } from './core/notifications/NotificationsComposePage';
import { ModulesAdminPage } from './core/modules/ModulesAdminPage';

function FullScreenLoader() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 64px)' }}>
      <CircularProgress />
    </Box>
  );
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
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (mustChangePassword) {
    return (
      <Routes>
        <Route path="/force-password-change" element={<ForcePasswordChangePage />} />
        <Route path="*" element={<Navigate to="/force-password-change" replace />} />
      </Routes>
    );
  }

  return (
    <PageLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
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
