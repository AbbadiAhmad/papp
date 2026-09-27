import {
  AppBar,
  Avatar,
  Box,
  Collapse,
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
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExtensionIcon from '@mui/icons-material/Extension';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import LockPersonIcon from '@mui/icons-material/LockPerson';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SettingsIcon from '@mui/icons-material/Settings';
import ShieldIcon from '@mui/icons-material/Shield';
import TranslateIcon from '@mui/icons-material/Translate';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { useLanguage } from '../../app/LanguageContext';
import { usePermission } from '../permissions';
import { NotificationsBellMenu } from '../../core/notifications/NotificationsBellMenu';
import { buildModuleMenuEntries, type ResolvedMenuLeaf, type ResolvedMenuNode } from '../modules/buildModuleMenuEntries';
import { resolveMenuIcon } from '../modules/menuIcons';
import { useModuleFrontendManifests } from '../modules/useInstalledModules';

const DRAWER_WIDTH = 260;

/** `requiredPermission: '__always__'` means "always shown once authenticated" (a genuinely self-scoped page, e.g. the dashboard) — mirrors `ResolvedMenuLeaf`'s shape exactly so both core and module leaves render through the same `NavLeafItem`. */
const ALWAYS_ALLOWED = '__always__';

/**
 * The platform's OWN menu entries — this stays hardcoded, deliberately:
 * these are core pages (Users, Roles, Audit, ...), not a module's, so there
 * is nothing to "decouple" here (root DECISIONS.md D78 is about MODULE
 * entries, added generically below via `buildModuleMenuEntries`). Wrapped
 * as one foldable "Platform" group (user's explicit request) — same
 * collapsible treatment as a module's own 2+-child group, for visual
 * consistency, even though core has no manifest-driven parent/child
 * structure of its own to derive one from.
 */
const CORE_MENU_LEAVES: ResolvedMenuLeaf[] = [
  { type: 'leaf', id: 'dashboard', labelKey: 'core.menu.dashboard', iconName: undefined, route: '/', requiredPermission: ALWAYS_ALLOWED },
  { type: 'leaf', id: 'users', labelKey: 'core.menu.users', iconName: undefined, route: '/users', requiredPermission: 'users.view' },
  { type: 'leaf', id: 'roles', labelKey: 'core.menu.roles', iconName: undefined, route: '/roles', requiredPermission: 'roles.view' },
  { type: 'leaf', id: 'permissions', labelKey: 'core.menu.permissions', iconName: undefined, route: '/permissions', requiredPermission: 'permissions.view' },
  { type: 'leaf', id: 'my-permissions', labelKey: 'core.menu.myPermissions', iconName: undefined, route: '/my-permissions', requiredPermission: 'permissions.view_my' },
  { type: 'leaf', id: 'sessions', labelKey: 'core.menu.sessions', iconName: undefined, route: '/sessions', requiredPermission: 'sessions.view_my' },
  { type: 'leaf', id: 'audit', labelKey: 'core.menu.audit', iconName: undefined, route: '/audit', requiredPermission: 'audit.view' },
  { type: 'leaf', id: 'notifications', labelKey: 'core.menu.notifications', iconName: undefined, route: '/notifications', requiredPermission: 'notifications.view' },
  { type: 'leaf', id: 'settings', labelKey: 'core.menu.settings', iconName: undefined, route: '/settings', requiredPermission: 'users.settings.view' },
  { type: 'leaf', id: 'modules', labelKey: 'core.menu.modules', iconName: undefined, route: '/modules', requiredPermission: 'modules.view' },
];

/** Fixed icon per core leaf id — kept separate from `CORE_MENU_LEAVES` (a plain, JSX-free data array) so that array can be shared/tested the same way a module's resolved leaves are. */
const CORE_ICONS: Record<string, ReactNode> = {
  dashboard: <DashboardIcon />,
  users: <GroupIcon />,
  roles: <AssignmentIndIcon />,
  permissions: <ShieldIcon />,
  'my-permissions': <ShieldIcon />,
  sessions: <LockPersonIcon />,
  audit: <HistoryIcon />,
  notifications: <NotificationsIcon />,
  settings: <SettingsIcon />,
  modules: <ExtensionIcon />,
};

function iconFor(node: ResolvedMenuLeaf | { id: string; iconName: string | undefined }): ReactNode {
  return CORE_ICONS[node.id] ?? resolveMenuIcon(node.iconName);
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  // NavList only ever renders inside PageLayout, which App.tsx only mounts
  // once fully authenticated (never anonymous, never must-change-password) —
  // always enabled here is correct (root D79: the endpoint requires a session).
  const moduleManifests = useModuleFrontendManifests(true);

  // Root DECISIONS.md D78: every installed module's own menu entries,
  // resolved generically from its manifest into group/leaf nodes —
  // App.tsx/PageLayout.tsx never import or name a module directly. See
  // buildModuleMenuEntries.ts's own docblock for the exact grouping rule.
  const moduleNodes = useMemo<ResolvedMenuNode[]>(() => buildModuleMenuEntries(moduleManifests ?? []), [moduleManifests]);

  const platformGroup: ResolvedMenuNode = useMemo(
    () => ({ type: 'group', id: 'platform', labelKey: 'core.menu.platform', iconName: undefined, children: CORE_MENU_LEAVES }),
    [],
  );

  const nodes = useMemo<ResolvedMenuNode[]>(() => [platformGroup, ...moduleNodes], [platformGroup, moduleNodes]);

  return (
    <List>
      {nodes.map((node) =>
        node.type === 'group' ? (
          <NavGroup key={node.id} group={node} activePath={location.pathname} onNavigate={onNavigate} t={t} />
        ) : (
          <NavLeafItem key={node.id} leaf={node} active={location.pathname === node.route} onNavigate={onNavigate} t={t} />
        ),
      )}
    </List>
  );
}

/**
 * A foldable group heading (the user's explicit request — previously a
 * module's 2+-child parent rendered nothing at all, D78; core's own items
 * were a flat list). `open` follows `containsActiveRoute` (auto-open
 * whenever one of this group's own pages is the current route — a
 * bookmark, deep link, or `RequirePermissionRoute` redirect never leaves
 * its own nav entry hidden behind a closed group) UNTIL the user actually
 * clicks the heading once, at which point their explicit choice wins from
 * then on, in either direction, for the rest of the session — no "auto-open
 * fights the user's manual close" tug-of-war. The heading itself is hidden
 * entirely when NONE of its children are currently visible (every child's
 * real permission check denied) — never an empty, clickable-but-pointless
 * group.
 */
function NavGroup({
  group,
  activePath,
  onNavigate,
  t,
}: {
  group: Extract<ResolvedMenuNode, { type: 'group' }>;
  activePath: string;
  onNavigate?: () => void;
  t: (key: string) => string;
}) {
  // `hasPermission` (from the single `useAuth()` call here) is a plain
  // function, not a hook — calling it inside `.some`/`.map` below is safe
  // and does NOT violate the rules of hooks, unlike calling `usePermission`
  // itself in a loop would (that hook wraps this same function but is only
  // meant to be called at a fixed, top-level position per component).
  const { hasPermission } = useAuth();
  const isVisible = (leaf: ResolvedMenuLeaf) => leaf.requiredPermission === ALWAYS_ALLOWED || hasPermission(leaf.requiredPermission);

  const containsActiveRoute = group.children.some((child) => child.route === activePath);
  // `forcedState` is `null` until the user actually clicks the heading —
  // while null, `open` simply follows `containsActiveRoute` (auto-open
  // when one of this group's own pages is active, closed otherwise, with
  // no separate "was it active before" tracking needed at all). Once the
  // user clicks, their explicit choice wins from then on, in either
  // direction — this replaces an earlier ref-based "did containsActiveRoute
  // just turn true" approach that read/wrote a ref during render, which
  // this project's stricter react-hooks/refs lint rule (no ref access
  // outside effects/handlers) correctly rejected.
  const [forcedState, setForcedState] = useState<boolean | null>(null);
  const open = forcedState ?? containsActiveRoute;

  const anyVisible = group.children.some(isVisible);
  if (!anyVisible) return null;

  return (
    <>
      <ListItemButton onClick={() => setForcedState(!open)}>
        <ListItemIcon>{iconFor(group)}</ListItemIcon>
        <ListItemText primary={t(group.labelKey)} />
        {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ListItemButton>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {group.children.map((child) =>
            isVisible(child) ? (
              <NavLeafItem key={child.id} leaf={child} active={activePath === child.route} onNavigate={onNavigate} t={t} indent />
            ) : null,
          )}
        </List>
      </Collapse>
    </>
  );
}

function NavLeafItem({
  leaf,
  active,
  onNavigate,
  t,
  indent,
}: {
  leaf: ResolvedMenuLeaf;
  active: boolean;
  onNavigate?: () => void;
  t: (key: string) => string;
  indent?: boolean;
}) {
  // usePermission is a UX convenience backed by AuthContext's real,
  // upfront-fetched permission set (shared/permissions.tsx) — never a
  // guessed/optimistic list. A grouped leaf's visibility was ALREADY
  // checked by `NavGroup` (via `hasPermission`, a plain function, not a
  // hook) before deciding to render this component at all — this is a
  // defensive second check, keeping `NavLeafItem` correct and self-hiding
  // even if ever rendered standalone, same as before this file's rework.
  const allowed = usePermission(leaf.requiredPermission);
  const visible = leaf.requiredPermission === ALWAYS_ALLOWED || allowed;
  if (!visible) return null;
  return (
    <ListItemButton component={RouterLink} to={leaf.route} selected={active} onClick={onNavigate} sx={indent ? { pl: 4 } : undefined}>
      <ListItemIcon>{iconFor(leaf)}</ListItemIcon>
      <ListItemText primary={t(leaf.labelKey)} />
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
