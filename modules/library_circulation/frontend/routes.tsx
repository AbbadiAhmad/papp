import type { ModuleRouteEntry } from '../../../apps/web/src/shared/modules/types';
import { BookHistoryPage } from './pages/BookHistoryPage';
import { BorrowingsPage } from './pages/BorrowingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { FinancePage } from './pages/FinancePage';
import { FinesPage } from './pages/FinesPage';
import { ScanPage } from './pages/ScanPage';
import { SettingsPage } from './pages/SettingsPage';
import { StudentDetailPage } from './pages/StudentDetailPage';
import { StudentsListPage } from './pages/StudentsListPage';

/**
 * The module's `frontend.entry` target (manifest.json). Exports the two
 * FIXED names (`authenticatedRoutes`/`publicRoutes`) every module's own
 * routes.tsx exports — this is the contract `apps/web/src/shared/modules/
 * discovery.ts` glob-imports generically (root DECISIONS.md D78), so
 * `App.tsx` never imports this file, or names this module, directly.
 */
export const authenticatedRoutes: ModuleRouteEntry[] = [
  { path: '/library-circulation/dashboard', element: <DashboardPage /> },
  { path: '/library-circulation/scan', element: <ScanPage /> },
  { path: '/library-circulation/students', element: <StudentsListPage /> },
  { path: '/library-circulation/students/:studentId', element: <StudentDetailPage /> },
  { path: '/library-circulation/borrowings', element: <BorrowingsPage /> },
  { path: '/library-circulation/fines', element: <FinesPage /> },
  { path: '/library-circulation/finance', element: <FinancePage /> },
  { path: '/library-circulation/books/:bookId/history', element: <BookHistoryPage /> },
  { path: '/library-circulation/settings', element: <SettingsPage /> },
];

/** No public routes — every screen in this module needs an authenticated, permission-gated staff session. */
export const publicRoutes: ModuleRouteEntry[] = [];
