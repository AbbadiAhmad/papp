import type { ReactNode } from 'react';
import { BookDetailPage } from './pages/BookDetailPage';
import { BooksListPage } from './pages/BooksListPage';
import { PublicBookAvailabilityPage } from './pages/PublicBookAvailabilityPage';

/**
 * The module's `frontend.entry` target (manifest.json). No dynamic
 * module-federation-style loading exists yet in apps/web (Phase 6 didn't
 * build one — BUILD_PLAN.md Phase 8's own note says a straightforward
 * addition to the app's static route table is acceptable for now), so
 * apps/web/src/App.tsx imports this file directly and spreads
 * `AUTHENTICATED_LIBRARY_CATALOG_ROUTES`/`PUBLIC_LIBRARY_CATALOG_ROUTES`
 * into its own `<Routes>` trees. Exported as plain `{path, element}` data
 * (not a `<Routes>` JSX fragment) so App.tsx can place each one under
 * whichever auth-status branch it belongs to (the public route must be
 * reachable from ALL of App.tsx's branches — anonymous, forced
 * password-change, and authenticated — per MODULE_SPEC.md §7.1 "never
 * redirects to the login page").
 */
export interface ModuleRouteEntry {
  path: string;
  element: ReactNode;
}

export const AUTHENTICATED_LIBRARY_CATALOG_ROUTES: ModuleRouteEntry[] = [
  { path: '/library/books', element: <BooksListPage /> },
  { path: '/library/books/:bookId', element: <BookDetailPage /> },
];

export const PUBLIC_LIBRARY_CATALOG_ROUTES: ModuleRouteEntry[] = [
  { path: '/library/public/books/:bookId/availability', element: <PublicBookAvailabilityPage /> },
];
