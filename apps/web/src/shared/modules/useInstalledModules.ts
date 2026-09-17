import { useEffect, useMemo, useState } from 'react';
import { modulesApi } from '../api/modules';
import type { FrontendModuleManifest } from '../api/types';
import { getAllDiscoveredModuleRoutes } from './discovery';
import type { ModuleRouteEntry } from './types';

/**
 * Fetches `GET /modules/frontend-manifest` once per app load (root
 * DECISIONS.md D78) — `@Public()` on the backend, so this resolves for an
 * anonymous visitor too, before any session exists. Returns `null` while
 * loading; `[]` on a genuine fetch failure (never blocks the shell from
 * rendering — core's own routes/menu always work regardless of this call).
 */
export function useModuleFrontendManifests(): FrontendModuleManifest[] | null {
  const [manifests, setManifests] = useState<FrontendModuleManifest[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    modulesApi
      .getFrontendManifest()
      .then((result) => {
        if (!cancelled) setManifests(result);
      })
      .catch(() => {
        if (!cancelled) setManifests([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return manifests;
}

/**
 * Every INSTALLED module's routes for the given access level, resolved from
 * the build-time-discovered `routes.tsx` files (`discovery.ts`) filtered to
 * only the module keys `GET /modules/frontend-manifest` reports as
 * installed. A module discovered on disk but not (yet) installed, or
 * installed but missing on disk (a stale registry row), is silently
 * skipped — never a crash, matching `module-loader.ts`'s own
 * missing-entry-skips behavior on the backend.
 */
export function useModuleRoutes(
  manifests: FrontendModuleManifest[] | null,
  access: 'public' | 'authenticated',
): ModuleRouteEntry[] {
  return useMemo(() => {
    if (!manifests) return [];
    const discovered = getAllDiscoveredModuleRoutes();
    const entries: ModuleRouteEntry[] = [];
    for (const manifest of manifests) {
      const routesModule = discovered.get(manifest.key);
      if (!routesModule) continue;
      const list = access === 'public' ? routesModule.publicRoutes : routesModule.authenticatedRoutes;
      if (list) entries.push(...list);
    }
    return entries;
  }, [manifests, access]);
}
