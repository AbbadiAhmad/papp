import type { ReactNode } from 'react';
import { TemplateItemsListPage } from './pages/TemplateItemsListPage';
import { TemplatePublicItemPage } from './pages/TemplatePublicItemPage';

/**
 * The module's `frontend.entry` target (manifest.json) — see
 * modules/library_catalog/frontend/routes.tsx's own docblock for why this is
 * a static import from apps/web/src/App.tsx rather than something
 * dynamically loaded (no module-federation-style mechanism exists yet).
 */
export interface ModuleRouteEntry {
  path: string;
  element: ReactNode;
}

export const AUTHENTICATED_TEMPLATE_ROUTES: ModuleRouteEntry[] = [{ path: '/template/items', element: <TemplateItemsListPage /> }];

export const PUBLIC_TEMPLATE_ROUTES: ModuleRouteEntry[] = [
  { path: '/template/public/items/:itemId', element: <TemplatePublicItemPage /> },
];
