import type { ModuleRouteEntry } from '../../../apps/web/src/shared/modules/types';
import { DashboardPage } from './pages/DashboardPage';
import { EpisodesPage } from './pages/EpisodesPage';
import { GroupsListPage } from './pages/GroupsListPage';
import { ReaderDetailPage } from './pages/ReaderDetailPage';
import { ReadersListPage } from './pages/ReadersListPage';

/**
 * The module's `frontend.entry` target (manifest.json). Exports the two
 * FIXED names (`authenticatedRoutes`/`publicRoutes`) every module's own
 * routes.tsx exports — see docs/MODULE_SPEC.md §7.6 / root DECISIONS.md D78.
 */
export const authenticatedRoutes: ModuleRouteEntry[] = [
  { path: '/reading-club/dashboard', element: <DashboardPage /> },
  { path: '/reading-club/readers', element: <ReadersListPage /> },
  { path: '/reading-club/readers/:studentId', element: <ReaderDetailPage /> },
  { path: '/reading-club/groups', element: <GroupsListPage /> },
  { path: '/reading-club/episodes', element: <EpisodesPage /> },
];

/** No public routes — every screen needs an authenticated, permission-gated staff session. */
export const publicRoutes: ModuleRouteEntry[] = [];
