import type { ModuleRoutesExport } from './types';

/**
 * Build-time discovery of every module's `frontend/routes.tsx` (root
 * DECISIONS.md D78) — Vite's `import.meta.glob` bundles whichever modules
 * physically exist under `modules/*` at build time, with NO per-module
 * import statement anywhere in platform code. Which of these are actually
 * MOUNTED (rendered as real routes/menu items) is decided at RUNTIME by
 * `useInstalledModuleKeys()`/`useModuleFrontendManifests()` (see
 * `useInstalledModules.ts`), fed by `GET /modules/frontend-manifest`.
 *
 * `eager: true` bundles every discovered module's route code into the main
 * chunk (no true runtime plugin loading/module-federation exists yet — see
 * this same limitation already accepted for backend-dist imports in
 * MODULE_SPEC.md §1). This means an UNINSTALLED module's JS still ships in
 * the bundle; it is simply never reachable (no route mounted, no menu item
 * rendered) once the installed-module filter runs. A future move to true
 * lazy/dynamic per-module chunks does not need to change this file's own
 * exported contract, only `eager: true` -> `eager: false` plus awaiting the
 * importer function.
 */
const moduleRouteFiles = import.meta.glob<ModuleRoutesExport>('../../../../../modules/*/frontend/routes.tsx', {
  eager: true,
});

const MODULE_KEY_PATTERN = /\/modules\/([^/]+)\/frontend\/routes\.tsx$/;

function extractModuleKey(globPath: string): string | null {
  const match = MODULE_KEY_PATTERN.exec(globPath);
  return match ? match[1] : null;
}

let cachedDiscoveredRoutes: Map<string, ModuleRoutesExport> | null = null;

/** Every module physically present on disk, keyed by module key — regardless of install status. */
export function getAllDiscoveredModuleRoutes(): Map<string, ModuleRoutesExport> {
  if (cachedDiscoveredRoutes) return cachedDiscoveredRoutes;
  const result = new Map<string, ModuleRoutesExport>();
  for (const [globPath, mod] of Object.entries(moduleRouteFiles)) {
    const key = extractModuleKey(globPath);
    if (key) result.set(key, mod);
  }
  cachedDiscoveredRoutes = result;
  return result;
}
