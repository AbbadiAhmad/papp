import type { ModuleRouteEntry } from '../../../apps/web/src/shared/modules/types';
import { MenuEditorPage } from './pages/MenuEditorPage';
import { PageEditorPage } from './pages/PageEditorPage';
import { PagesListPage } from './pages/PagesListPage';
import { PublicSitePage } from './pages/PublicSitePage';

/**
 * The module's `frontend.entry` target (manifest.json). Exports the two
 * FIXED names (`authenticatedRoutes`/`publicRoutes`) every module's own
 * routes.tsx exports — this is the contract `apps/web/src/shared/modules/
 * discovery.ts` glob-imports generically (root DECISIONS.md D78), so
 * `App.tsx` never imports this file, or names this module, directly.
 */
export const authenticatedRoutes: ModuleRouteEntry[] = [
  { path: '/site/admin/pages', element: <PagesListPage /> },
  { path: '/site/admin/pages/:pageId', element: <PageEditorPage /> },
  { path: '/site/admin/menus', element: <MenuEditorPage /> },
];

/**
 * `/site/:slug` and the bare `/site` (homepage) — React Router v6 ranks the
 * static `/site/admin/*` routes above this dynamic segment regardless of
 * array/declaration order, so admin pages are never shadowed by a visitor's
 * page slug (the reserved-slug check in `create-page.dto.ts` is the
 * server-side belt to this client-side suspenders).
 */
export const publicRoutes: ModuleRouteEntry[] = [
  { path: '/site/:slug', element: <PublicSitePage /> },
  { path: '/site', element: <PublicSitePage /> },
];
