import type { ReactNode } from 'react';
import { MenuEditorPage } from './pages/MenuEditorPage';
import { PageEditorPage } from './pages/PageEditorPage';
import { PagesListPage } from './pages/PagesListPage';
import { PublicSitePage } from './pages/PublicSitePage';

/** The module's `frontend.entry` target (manifest.json) — same static-route-table pattern as every other module (no dynamic module-federation-style loading exists yet). */
export interface ModuleRouteEntry {
  path: string;
  element: ReactNode;
}

export const AUTHENTICATED_WEBSITE_ROUTES: ModuleRouteEntry[] = [
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
export const PUBLIC_WEBSITE_ROUTES: ModuleRouteEntry[] = [
  { path: '/site/:slug', element: <PublicSitePage /> },
  { path: '/site', element: <PublicSitePage /> },
];
