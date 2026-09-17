import type { ModuleRouteEntry } from '../../../apps/web/src/shared/modules/types';
import { TemplateItemsListPage } from './pages/TemplateItemsListPage';
import { TemplatePublicItemPage } from './pages/TemplatePublicItemPage';

/**
 * The module's `frontend.entry` target (manifest.json). Exports the two
 * FIXED names (`authenticatedRoutes`/`publicRoutes`) every module's own
 * routes.tsx exports — this is the contract `apps/web/src/shared/modules/
 * discovery.ts` glob-imports generically (root DECISIONS.md D78), so
 * `App.tsx` never imports this file, or names this module, directly. Copy
 * this file's shape verbatim when starting a new module from this scaffold.
 */
export const authenticatedRoutes: ModuleRouteEntry[] = [{ path: '/template/items', element: <TemplateItemsListPage /> }];

export const publicRoutes: ModuleRouteEntry[] = [
  { path: '/template/public/items/:itemId', element: <TemplatePublicItemPage /> },
];
