import {
  AppBar,
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ExtensionIcon from '@mui/icons-material/Extension';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import LockPersonIcon from '@mui/icons-material/LockPerson';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import NotificationsIcon from '@mui/icons-material/Notifications';
import PaidIcon from '@mui/icons-material/Paid';
import PollIcon from '@mui/icons-material/Poll';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SettingsIcon from '@mui/icons-material/Settings';
import ShieldIcon from '@mui/icons-material/Shield';
import TranslateIcon from '@mui/icons-material/Translate';
import WidgetsIcon from '@mui/icons-material/Widgets';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { useLanguage } from '../../app/LanguageContext';
import { usePermission } from '../permissions';
import { NotificationsBellMenu } from '../../core/notifications/NotificationsBellMenu';

const DRAWER_WIDTH = 260;

interface MenuItemDef {
  id: string;
  labelKey: string;
  icon: ReactNode;
  route: string;
  /** null = always shown (self-scoped page, or the D12 Permissions page). */
  permissionCode: string | null;
}

const MENU_ITEMS: MenuItemDef[] = [
  { id: 'dashboard', labelKey: 'core.menu.dashboard', icon: <DashboardIcon />, route: '/', permissionCode: null },
  { id: 'users', labelKey: 'core.menu.users', icon: <GroupIcon />, route: '/users', permissionCode: 'users.view' },
  { id: 'roles', labelKey: 'core.menu.roles', icon: <AssignmentIndIcon />, route: '/roles', permissionCode: 'roles.view' },
  { id: 'permissions', labelKey: 'core.menu.permissions', icon: <ShieldIcon />, route: '/permissions', permissionCode: null },
  { id: 'sessions', labelKey: 'core.menu.sessions', icon: <LockPersonIcon />, route: '/sessions', permissionCode: null },
  { id: 'audit', labelKey: 'core.menu.audit', icon: <HistoryIcon />, route: '/audit', permissionCode: 'audit.view' },
  { id: 'notifications', labelKey: 'core.menu.notifications', icon: <NotificationsIcon />, route: '/notifications', permissionCode: null },
  { id: 'settings', labelKey: 'core.menu.settings', icon: <SettingsIcon />, route: '/settings', permissionCode: 'users.settings.view' },
  { id: 'modules', labelKey: 'core.menu.modules', icon: <ExtensionIcon />, route: '/modules', permissionCode: 'modules.view' },
  // Phase 8 — library_catalog module. This sidebar list is a static array,
  // not yet driven from the `module_menu_entries` table ModuleRegistryService
  // populates at install time (no such generic-menu-rendering mechanism was
  // built in Phase 5/6 — flagged in this Developer agent's report as a real
  // gap: today, EVERY installed module needs this same manual addition here).
  {
    id: 'library_catalog',
    labelKey: 'library_catalog.menu.books',
    icon: <MenuBookIcon />,
    route: '/library/books',
    permissionCode: 'library_catalog.books.view',
  },
  // library_circulation + library_finance module (D44) — same documented gap as library_catalog above.
  {
    id: 'library_circulation.scan',
    labelKey: 'library_circulation.menu.scan',
    icon: <QrCodeScannerIcon />,
    route: '/library-circulation/scan',
    permissionCode: 'library_circulation.borrow',
  },
  {
    id: 'library_circulation.students',
    labelKey: 'library_circulation.menu.students',
    icon: <GroupIcon />,
    route: '/library-circulation/students',
    permissionCode: 'library_circulation.students.view',
  },
  {
    id: 'library_circulation.fines',
    labelKey: 'library_circulation.menu.fines',
    icon: <PaidIcon />,
    route: '/library-circulation/fines',
    permissionCode: 'library_circulation.fines.view',
  },
  {
    id: 'library_circulation.finance',
    labelKey: 'library_circulation.menu.finance',
    icon: <PaidIcon />,
    route: '/library-circulation/finance',
    permissionCode: 'library_circulation.finance.view',
  },
  // Survey module — same documented gap as library_catalog above.
  {
    id: 'survey',
    labelKey: 'survey.menu.root',
    icon: <PollIcon />,
    route: '/survey/surveys',
    permissionCode: 'survey.surveys.view',
  },
  // Template module (docs/MODULE_SPEC.md §10) — the canonical scaffold, kept
  // installed as a genuinely working example. Same documented gap as above.
  {
    id: 'template',
    labelKey: 'template.menu.root',
    icon: <WidgetsIcon />,
    route: '/template/items',
    permissionCode: 'template.items.view',
  },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <List>
      {MENU_ITEMS.map((item) => (
        <NavListItem key={item.id} item={item} active={location.pathname === item.route} onNavigate={onNavigate} t={t} />
      ))}
    </List>
  );
}

function NavListItem({
  item,
  active,
  onNavigate,
  t,
}: {
  item: MenuItemDef;
  active: boolean;
  onNavigate?: () => void;
  t: (key: string) => string;
}) {
  // usePermission is a UX convenience that only reflects a REAL prior 403
  // (see shared/permissions.tsx) — it never pre-hides from a guessed list,
  // so every item is visible until the user has actually visited it once
  // and been denied.
  const allowed = usePermission(item.permissionCode ?? '__always__');
  if (item.permissionCode && !allowed) return null;
  return (
    <ListItemButton component={RouterLink} to={item.route} selected={active} onClick={onNavigate}>
      <ListItemIcon>{item.icon}</ListItemIcon>
      <ListItemText primary={t(item.labelKey)} />
    </ListItemButton>
  );
}

/**
 * Always mounted (App.tsx renders this at the root regardless of auth
 * status) — the brand bar, language switcher, and (once authenticated) the
 * notifications bell + user menu. Split out from the drawer/content area so
 * the brand is on-screen from the very first render (login page included),
 * not only once a session exists.
 */
export function TopBar() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const [langMenuAnchor, setLangMenuAnchor] = useState<HTMLElement | null>(null);

  const handleLogout = async () => {
    setUserMenuAnchor(null);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
      <Toolbar sx={{ gap: 2 }}>
        <Typography variant="h6" component="h1" sx={{ flexGrow: 1, fontWeight: 700 }}>
          papp
        </Typography>

        {status === 'authenticated' ? <NotificationsBellMenu /> : null}

        <Tooltip title={t('core.common.language')}>
          <IconButton color="inherit" onClick={(e) => setLangMenuAnchor(e.currentTarget)} aria-label={t('core.common.language')}>
            <TranslateIcon />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={langMenuAnchor} open={Boolean(langMenuAnchor)} onClose={() => setLangMenuAnchor(null)}>
          <MenuItem
            selected={language === 'ar'}
            onClick={() => {
              setLanguage('ar');
              setLangMenuAnchor(null);
            }}
          >
            العربية
          </MenuItem>
          <MenuItem
            selected={language === 'en'}
            onClick={() => {
              setLanguage('en');
              setLangMenuAnchor(null);
            }}
          >
            English
          </MenuItem>
        </Menu>

        {user ? (
          <>
            <IconButton onClick={(e) => setUserMenuAnchor(e.currentTarget)} aria-label={user.name}>
              <Avatar sx={{ width: 32, height: 32 }}>{user.name.charAt(0).toUpperCase()}</Avatar>
            </IconButton>
            <Menu anchorEl={userMenuAnchor} open={Boolean(userMenuAnchor)} onClose={() => setUserMenuAnchor(null)}>
              <MenuItem disabled>{user.email}</MenuItem>
              <Divider />
              <MenuItem
                onClick={() => {
                  setUserMenuAnchor(null);
                  navigate('/my-preferences');
                }}
              >
                <ListItemIcon>
                  <ManageAccountsIcon fontSize="small" />
                </ListItemIcon>
                {t('core.menu.myPreferences')}
              </MenuItem>
              <MenuItem onClick={handleLogout}>
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                {t('core.auth.logout')}
              </MenuItem>
            </Menu>
          </>
        ) : null}
      </Toolbar>
    </AppBar>
  );
}

/**
 * The sidebar + content area for authenticated, password-current sessions.
 * `TopBar` is rendered separately (once, at the App root) — this only adds
 * the drawer (see the `anchor` note just below) and the routed page content.
 *
 * `anchor` is deliberately ALWAYS `"left"`, never toggled by `direction`.
 * `app/theme.ts`'s RTL emotion cache (`stylis-plugin-rtl`) already mirrors
 * EVERY generated CSS declaration (`left`<->`right`, `border-left`<->
 * `border-right`, ...) for the whole app when `direction === 'rtl'` —
 * that's what makes plain MUI `sx`/`styled` RTL-safe without hand-writing
 * logical properties (ARCHITECTURE.md §9). `anchor` feeds MUI's OWN
 * variant-selection logic (`left` -> `{left:0, borderRight}` CSS, `right`
 * -> `{right:0, borderLeft}`), and that generated CSS then ALSO goes
 * through the same RTL mirroring. Toggling `anchor` here on top of that
 * double-flips it back to the original side — this Developer agent found
 * that exact regression via a real browser check (manual verification, not
 * assumed) before fixing it to this single, always-"left" value, which the
 * RTL plugin alone correctly renders on the physical right in RTL mode.
 */
export function PageLayout({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexGrow: 1 }}>
      <Drawer
        variant="permanent"
        anchor="left"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <NavList />
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0 }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
