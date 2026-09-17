import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ExtensionIcon from '@mui/icons-material/Extension';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import LockPersonIcon from '@mui/icons-material/LockPerson';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import NotificationsIcon from '@mui/icons-material/Notifications';
import PaidIcon from '@mui/icons-material/Paid';
import PollIcon from '@mui/icons-material/Poll';
import PublicIcon from '@mui/icons-material/Public';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SettingsIcon from '@mui/icons-material/Settings';
import ShieldIcon from '@mui/icons-material/Shield';
import WidgetsIcon from '@mui/icons-material/Widgets';
import type { ReactNode } from 'react';

/**
 * A module's manifest `menu[].icon` is a plain string name (schema:
 * `packages/shared-types/src/module-manifest.ts`'s `menuEntrySchema`), not a
 * React element — there is no per-module TSX file to import a REAL icon
 * component from any more (root DECISIONS.md D78). This is a deliberate,
 * documented, minor exception to "zero platform edits to add a module": a
 * BRAND NEW icon name never used before falls back to the generic
 * `ExtensionIcon` until someone bothers to add a nicer one here — a module
 * is always fully installable/usable without this map ever being touched,
 * this is cosmetic only. The alternative (a fully dynamic
 * `import(`@mui/icons-material/${name}`)`) was considered and rejected:
 * it needs a `<Suspense>` boundary around every single icon render for a
 * purely decorative detail, real complexity for no functional gain.
 */
const KNOWN_ICONS: Record<string, ReactNode> = {
  AssignmentInd: <AssignmentIndIcon />,
  Dashboard: <DashboardIcon />,
  Extension: <ExtensionIcon />,
  Group: <GroupIcon />,
  History: <HistoryIcon />,
  LockPerson: <LockPersonIcon />,
  MenuBook: <MenuBookIcon />,
  Notifications: <NotificationsIcon />,
  Paid: <PaidIcon />,
  Poll: <PollIcon />,
  Public: <PublicIcon />,
  QrCodeScanner: <QrCodeScannerIcon />,
  Settings: <SettingsIcon />,
  Shield: <ShieldIcon />,
  Widgets: <WidgetsIcon />,
};

export function resolveMenuIcon(iconName: string | undefined): ReactNode {
  if (!iconName) return <ExtensionIcon />;
  return KNOWN_ICONS[iconName] ?? <ExtensionIcon />;
}
