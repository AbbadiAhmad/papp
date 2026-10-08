import {
  AppBar,
  Avatar,
  Box,
  Chip,
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
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExtensionIcon from '@mui/icons-material/Extension';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import LockPersonIcon from '@mui/icons-material/LockPerson';
import LogoutIcon from '@mui/icons-material/Logout';
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import LocalLibraryIcon from '@mui/icons-material/LocalLibrary';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import PaletteIcon from '@mui/icons-material/Palette';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SettingsIcon from '@mui/icons-material/Settings';
import ShieldIcon from '@mui/icons-material/Shield';
import TranslateIcon from '@mui/icons-material/Translate';
import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { useLanguage } from '../../app/LanguageContext';
import { useColorMode } from '../../app/ColorModeContext';
import { useMenuLayout, useThemePack } from '../../app/AppearanceContext';
import { applyMenuLayout, labelOf } from '../modules/applyMenuLayout';
import { usePermission } from '../permissions';
import { NotificationsBellMenu } from '../../core/notifications/NotificationsBellMenu';
import { buildModuleMenuEntries, type ResolvedMenuLeaf, type ResolvedMenuNode } from '../modules/buildModuleMenuEntries';
import { resolveMenuIcon } from '../modules/menuIcons';
import { useModuleFrontendManifests } from '../modules/useInstalledModules';

const DRAWER_WIDTH = 260;

/**
 * Shared open/close state for the mobile (below `sm`) overlay drawer.
 * `TopBar` (the hamburger button) and `PageLayout` (the `Drawer` itself) are
 * rendered as siblings, not nested, in `App.tsx`'s `ThemedShell` — `TopBar`
 * mounts even when anonymous (no drawer exists yet), `PageLayout` only once
 * authenticated — so a plain lifted-state prop can't bridge them; a small
 * context colocated with the two components it connects is simpler here
 * than reaching for prop-drilling through `App.tsx` or a whole new file.
 */
const MobileNavContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

function useMobileNav() {
  const ctx = useContext(MobileNavContext);
  if (!ctx) throw new Error('useMobileNav must be used within a MobileNavProvider');
  return ctx;
}

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
  { type: 'leaf', id: 'backup', labelKey: 'core.menu.backup', iconName: undefined, route: '/backup', requiredPermission: 'backup.export' },
  { type: 'leaf', id: 'notifications', labelKey: 'core.menu.notifications', iconName: undefined, route: '/notifications', requiredPermission: 'notifications.view' },
  { type: 'leaf', id: 'settings', labelKey: 'core.menu.settings', iconName: undefined, route: '/settings', requiredPermission: 'users.settings.view' },
  { type: 'leaf', id: 'appearance', labelKey: 'core.menu.appearance', iconName: undefined, route: '/appearance', requiredPermission: 'appearance.view' },
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
  backup: <CloudDownloadIcon />,
  notifications: <NotificationsIcon />,
  settings: <SettingsIcon />,
  appearance: <PaletteIcon />,
  modules: <ExtensionIcon />,
};

function iconFor(node: ResolvedMenuLeaf | { id: string; iconName: string | undefined }): ReactNode {
  return CORE_ICONS[node.id] ?? resolveMenuIcon(node.iconName);
}

/**
 * The sidebar/tab nodes: platform group + every installed module's menu,
 * then the admin's menu layout (appearance, D96) applied on top. Shared by
 * the sidebar (`NavList`) and the tabs shell (`TabsNav`).
 */
export function useNavNodes(): ResolvedMenuNode[] {
  // Only ever rendered inside PageLayout, which App.tsx mounts once fully
  // authenticated — always enabled here is correct (root D79).
  const moduleManifests = useModuleFrontendManifests(true);
  const { layout } = useMenuLayout();

  // Root DECISIONS.md D78: every installed module's own menu entries,
  // resolved generically from its manifest — see buildModuleMenuEntries.ts.
  const moduleNodes = useMemo<ResolvedMenuNode[]>(() => buildModuleMenuEntries(moduleManifests ?? []), [moduleManifests]);

  const platformGroup: ResolvedMenuNode = useMemo(
    () => ({ type: 'group', id: 'platform', labelKey: 'core.menu.platform', iconName: undefined, children: CORE_MENU_LEAVES }),
    [],
  );

  return useMemo<ResolvedMenuNode[]>(() => applyMenuLayout([platformGroup, ...moduleNodes], layout), [platformGroup, moduleNodes, layout]);
}

/** Every default (un-customised) node — what the Appearance page's menu editor starts from. */
export function useDefaultNavNodes(): ResolvedMenuNode[] {
  const moduleManifests = useModuleFrontendManifests(true);
  return useMemo<ResolvedMenuNode[]>(
    () => [{ type: 'group', id: 'platform', labelKey: 'core.menu.platform', iconName: undefined, children: CORE_MENU_LEAVES }, ...buildModuleMenuEntries(moduleManifests ?? [])],
    [moduleManifests],
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const nodes = useNavNodes();

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
  const { language } = useLanguage();
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
        <ListItemText primary={labelOf(group, language, t)} />
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
  const { language } = useLanguage();
  const allowed = usePermission(leaf.requiredPermission);
  const visible = leaf.requiredPermission === ALWAYS_ALLOWED || allowed;
  if (!visible) return null;
  return (
    <ListItemButton component={RouterLink} to={leaf.route} selected={active} onClick={onNavigate} sx={indent ? { pl: 4 } : undefined}>
      <ListItemIcon>{iconFor(leaf)}</ListItemIcon>
      <ListItemText primary={labelOf(leaf, language, t)} />
    </ListItemButton>
  );
}

/**
 * The `tabs` shell (theme packs, D95): the menu groups as top tabs, with the
 * active group's pages as a second row. Same nodes, same permission checks
 * and same labels as the sidebar — only the presentation differs. A group's
 * tab opens its first visible page.
 */
function TabsNav() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { hasPermission } = useAuth();
  const nodes = useNavNodes();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const isVisible = (leaf: ResolvedMenuLeaf) => leaf.requiredPermission === ALWAYS_ALLOWED || hasPermission(leaf.requiredPermission);
  const tabs = nodes
    .map((node) => ({ node, leaves: (node.type === 'leaf' ? [node] : node.children).filter(isVisible) }))
    .filter((tab) => tab.leaves.length > 0);
  const active = tabs.find((tab) => tab.leaves.some((leaf) => leaf.route === pathname));

  return (
    <Box data-app-shell="tabs" sx={{ mb: 2 }}>
      <Tabs
        value={active?.node.id ?? false}
        variant="scrollable"
        scrollButtons="auto"
        aria-label={t('core.common.menu')}
        sx={{ '& .MuiTab-root': { gap: 1, minHeight: 48 } }}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.node.id}
            value={tab.node.id}
            icon={iconFor(tab.node) as ReactElement}
            iconPosition="start"
            label={labelOf(tab.node, language, t)}
            onClick={() => navigate(tab.leaves[0].route)}
          />
        ))}
      </Tabs>
      {active && active.leaves.length > 1 ? (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', pt: 1.5 }}>
          {active.leaves.map((leaf) => (
            <Chip
              key={leaf.id}
              component={RouterLink}
              to={leaf.route}
              clickable
              color={leaf.route === pathname ? 'primary' : 'default'}
              variant={leaf.route === pathname ? 'filled' : 'outlined'}
              label={labelOf(leaf, language, t)}
            />
          ))}
        </Box>
      ) : null}
    </Box>
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { open: mobileNavOpen, setOpen: setMobileNavOpen } = useMobileNav();
  const tabsShell = useThemePack().pack?.shell === 'tabs';
  const { preference: colorMode, cycle: cycleColorMode } = useColorMode();
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const [langMenuAnchor, setLangMenuAnchor] = useState<HTMLElement | null>(null);

  const handleLogout = async () => {
    setUserMenuAnchor(null);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <AppBar position="fixed" data-app-shell="topbar" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
      <Toolbar sx={{ gap: 2 }}>
        {/* Hamburger only once authenticated (that's the only time PageLayout's
            drawer exists) and only on mobile — desktop keeps the always-visible
            permanent sidebar, no toggle needed. */}
        {status === 'authenticated' && isMobile && !tabsShell ? (
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-label={t('core.common.menu')}
          >
            <MenuIcon />
          </IconButton>
        ) : null}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1, minWidth: 0 }}>
          <Box
            aria-hidden
            sx={{ width: 40, height: 40, borderRadius: 1.5, bgcolor: '#fff', color: 'primary.dark', display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: 2 }}
          >
            <LocalLibraryIcon />
          </Box>
          <Typography variant="h6" component="h1" noWrap sx={{ fontWeight: 800, letterSpacing: 0.2, textShadow: '0 1px 4px rgba(0,0,0,.4)' }}>
            Annur Apps
          </Typography>
        </Box>

        {status === 'authenticated' ? <NotificationsBellMenu /> : null}

        <Tooltip title={t(`core.common.colorMode.${colorMode}`)}>
          <IconButton color="inherit" onClick={cycleColorMode} aria-label={t(`core.common.colorMode.${colorMode}`)}>
            {colorMode === 'dark' ? <DarkModeIcon /> : colorMode === 'light' ? <LightModeIcon /> : <BrightnessAutoIcon />}
          </IconButton>
        </Tooltip>

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
  const { open: mobileNavOpen, setOpen: setMobileNavOpen } = useMobileNav();
  const closeMobileNav = () => setMobileNavOpen(false);
  const tabsShell = useThemePack().pack?.shell === 'tabs';

  if (tabsShell) {
    return (
      <Box component="main" data-app-shell="main" sx={{ flexGrow: 1, p: { xs: 2, sm: 3 }, minWidth: 0 }}>
        <Toolbar data-app-shell="main-spacer" />
        <TabsNav />
        {children}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexGrow: 1 }}>
      {/* Mobile (below `sm`): a temporary overlay drawer toggled by TopBar's
          hamburger button, closing itself after a nav click or backdrop tap —
          never both variants mounted-and-visible at the same breakpoint. */}
      <Drawer
        variant="temporary"
        anchor="left"
        open={mobileNavOpen}
        onClose={closeMobileNav}
        ModalProps={{ keepMounted: true }}
        // `data-app-shell` goes on `slotProps.paper` (the actual visible
        // drawer panel), not the Drawer/Modal root — the root is a
        // non-visual positioning wrapper, so tagging it wouldn't reliably
        // select the printed-looking element a plain CSS attribute selector
        // needs (see the global print rule in App.tsx's GlobalStyles).
        slotProps={{ paper: { 'data-app-shell': 'drawer' } as Record<string, string> }}
        sx={{
          display: { xs: 'block', sm: 'none' },
          [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <NavList onNavigate={closeMobileNav} />
      </Drawer>

      {/* Desktop (`sm` and up): today's always-visible permanent sidebar, unchanged. */}
      <Drawer
        variant="permanent"
        anchor="left"
        // The Drawer ROOT reserves DRAWER_WIDTH of flex space even when its
        // Paper is hidden for print — tag it too so the global print rule
        // collapses it (otherwise printed content is shifted/clipped by it).
        data-app-shell="drawer-root"
        slotProps={{ paper: { 'data-app-shell': 'drawer' } as Record<string, string> }}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          display: { xs: 'none', sm: 'block' },
          [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <NavList />
      </Drawer>

      <Box component="main" data-app-shell="main" sx={{ flexGrow: 1, p: { xs: 2, sm: 3 }, minWidth: 0 }}>
        {/* AppBar-offset spacer, not shell chrome itself — tagged separately
            so the global print rule (App.tsx) can collapse it too, instead
            of leaving blank space where it used to sit. */}
        <Toolbar data-app-shell="main-spacer" />
        {children}
      </Box>
    </Box>
  );
}
