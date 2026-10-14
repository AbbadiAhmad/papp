import { Alert, Box, Card, CardContent, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { useLanguage } from '../../app/LanguageContext';
import { formatDateOnly, formatDateTime } from '../../shared/format';
import { MyPermissionsPage } from '../permissions/MyPermissionsPage';
import { SessionsPage } from '../sessions/SessionsPage';
import { ChangePasswordPage } from './ChangePasswordPage';
import { MyPreferencesPage } from './MyPreferencesPage';

/**
 * "My account": one place for everything personal, reached from the avatar menu.
 * The tab is the last URL segment (`/account/:tab`). Every tab except the profile
 * keeps its own permission code (hidden when missing, and the page behind it is
 * still guarded by the backend); the profile is read-only by design — only the
 * password is changeable by the user.
 */
interface AccountTab {
  id: string;
  labelKey: string;
  permission: string | null;
  render: () => React.ReactNode;
}

const TABS: AccountTab[] = [
  { id: 'profile', labelKey: 'core.account.tabProfile', permission: null, render: () => <ProfilePanel /> },
  { id: 'preferences', labelKey: 'core.menu.myPreferences', permission: null, render: () => <MyPreferencesPage /> },
  { id: 'password', labelKey: 'core.menu.changePassword', permission: 'users.password.change_my', render: () => <ChangePasswordPage /> },
  { id: 'permissions', labelKey: 'core.menu.myPermissions', permission: 'permissions.view_my', render: () => <MyPermissionsPage /> },
  { id: 'sessions', labelKey: 'core.menu.sessions', permission: 'sessions.view_my', render: () => <SessionsPage /> },
];

export function AccountPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const visible = TABS.filter((entry) => entry.permission === null || hasPermission(entry.permission));
  const current = visible.find((entry) => entry.id === (tab ?? 'profile'));
  if (!current) return <Navigate to="/account" replace />;

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.account.title')}
      </Typography>
      <Tabs
        value={current.id}
        onChange={(_, value: string) => navigate(value === 'profile' ? '/account' : `/account/${value}`)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label={t('core.account.title')}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {visible.map((entry) => (
          <Tab key={entry.id} value={entry.id} label={t(entry.labelKey)} />
        ))}
      </Tabs>
      {current.render()}
    </Box>
  );
}

/** Read-only view of the signed-in user's own stored record. */
function ProfilePanel() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { user } = useAuth();
  if (!user) return null;
  const none = t('core.account.none');
  const rows: Array<[string, React.ReactNode]> = [
    [t('core.account.name'), user.name],
    [t('core.account.email'), user.email],
    [t('core.users.external_id'), user.externalId ?? none],
    [t('core.users.department'), user.department ?? none],
    [t('core.users.date_of_birth'), user.dateOfBirth ? formatDateOnly(user.dateOfBirth, language) : none],
    [t('core.users.status'), <Chip key="s" size="small" color={user.isActive ? 'success' : 'default'} label={t(user.isActive ? 'core.account.statusActive' : 'core.account.statusInactive')} />],
    [t('core.users.last_login'), user.lastLoginAt ? formatDateTime(user.lastLoginAt, language) : none],
    [t('core.account.memberSince'), formatDateOnly(user.createdAt, language)],
  ];
  return (
    <Stack spacing={2} sx={{ maxWidth: 640 }}>
      <Alert severity="info">{t('core.account.profileNote')}</Alert>
      <Card>
        <CardContent>
          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '200px 1fr' }, rowGap: 1.5, columnGap: 2 }}>
            {rows.map(([label, value]) => (
              <Box key={label} sx={{ display: 'contents' }}>
                <Typography component="dt" color="text.secondary" sx={{ fontWeight: 700 }}>
                  {label}
                </Typography>
                <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
