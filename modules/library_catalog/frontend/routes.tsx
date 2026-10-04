import type { ModuleRouteEntry } from '../../../apps/web/src/shared/modules/types';
import { BookDetailPage } from './pages/BookDetailPage';
import { BooksListPage } from './pages/BooksListPage';
import { ModerateReviewsPage } from './pages/ModerateReviewsPage';
import { PrintCodesPage } from './pages/PrintCodesPage';
import { PublicBookAvailabilityPage } from './pages/PublicBookAvailabilityPage';

/**
 * The module's `frontend.entry` target (manifest.json). Exports the two
 * FIXED names (`authenticatedRoutes`/`publicRoutes`) every module's own
 * routes.tsx exports — this is the contract `apps/web/src/shared/modules/
 * discovery.ts` glob-imports generically (root DECISIONS.md D78), so
 * `App.tsx` never imports this file, or names this module, directly.
 */
export const authenticatedRoutes: ModuleRouteEntry[] = [
  { path: '/library/books', element: <BooksListPage /> },
  { path: '/library/books/:bookId', element: <BookDetailPage /> },
  { path: '/library/reviews/moderate', element: <ModerateReviewsPage /> },
  { path: '/library/copies/print-codes', element: <PrintCodesPage /> },
];

export const publicRoutes: ModuleRouteEntry[] = [
  { path: '/library/public/books/:bookId/availability', element: <PublicBookAvailabilityPage /> },
];
