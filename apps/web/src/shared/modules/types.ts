import type { ReactNode } from 'react';

/**
 * A single module-owned route (root DECISIONS.md D78). Every module's
 * `frontend/routes.tsx` exports two arrays of these — `authenticatedRoutes`
 * and `publicRoutes` — under these EXACT names, so the generic discovery
 * mechanism in `discovery.ts` can glob-import any module's routes file
 * without knowing that module's name. Defined once, here, instead of being
 * redeclared per module (the pre-D78 pattern).
 */
export interface ModuleRouteEntry {
  path: string;
  element: ReactNode;
}

/** The fixed shape every `modules/<key>/frontend/routes.tsx` must export. */
export interface ModuleRoutesExport {
  authenticatedRoutes?: ModuleRouteEntry[];
  publicRoutes?: ModuleRouteEntry[];
}
