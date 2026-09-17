import type { ReactNode } from 'react';
import { FinancePage } from './pages/FinancePage';
import { FinesPage } from './pages/FinesPage';
import { ScanPage } from './pages/ScanPage';
import { StudentDetailPage } from './pages/StudentDetailPage';
import { StudentsListPage } from './pages/StudentsListPage';

/** The module's `frontend.entry` target (manifest.json) — same static-route-table pattern as every other module (no dynamic module-federation-style loading exists yet). */
export interface ModuleRouteEntry {
  path: string;
  element: ReactNode;
}

export const AUTHENTICATED_LIBRARY_CIRCULATION_ROUTES: ModuleRouteEntry[] = [
  { path: '/library-circulation/scan', element: <ScanPage /> },
  { path: '/library-circulation/students', element: <StudentsListPage /> },
  { path: '/library-circulation/students/:studentId', element: <StudentDetailPage /> },
  { path: '/library-circulation/fines', element: <FinesPage /> },
  { path: '/library-circulation/finance', element: <FinancePage /> },
];

/** No public routes — every screen in this module needs an authenticated, permission-gated staff session. */
export const PUBLIC_LIBRARY_CIRCULATION_ROUTES: ModuleRouteEntry[] = [];
