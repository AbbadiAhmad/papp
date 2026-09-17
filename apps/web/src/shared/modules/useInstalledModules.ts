import { useEffect, useMemo, useState } from 'react';
import { modulesApi } from '../api/modules';
import type { FrontendModuleManifest } from '../api/types';
import { getAllDiscoveredModuleRoutes } from './discovery';
import type { ModuleRouteEntry } from './types';

/**
 * Fetches `GET /modules/frontend-manifest` (root DECISIONS.md D78/D79) only
 * while `enabled` — the backend requires authentication (no specific
 * permission, same "logged in is enough" category as `GET /users/me`), so
 * callers pass `status === 'authenticated' && !mustChangePassword` from
 * `useAuth()` rather than this hook reaching into that context itself,
 * keeping it decoupled from `AuthContext`'s exact shape. Returns `null`
 * while disabled/loading; `[]` on a genuine fetch failure (never blocks the
 * shell from rendering — core's own routes/menu always work regardless).
 */
export function useModuleFrontendManifests(enabled: boolean): FrontendModuleManifest[] | null {
  const [manifests, setManifests] = useState<FrontendModuleManifest[] | null>(null);

  useEffect(() => {
    if (!enabled) {
      setManifests(null);
      return;
    }
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
  }, [enabled]);

  return manifests;
}

/**
 * Every module's PUBLIC routes, from every `routes.tsx` file discovered at
 * build time (`discovery.ts`) — deliberately NOT filtered by install status
 * and NOT dependent on any network call (root D79): a public route's own
 * underlying API 404s gracefully if that module isn't actually installed,
 * exactly as it always has, so there is nothing to gain — and real
 * information to lose (see `GET /modules/frontend-manifest`'s own
 * docblock) — from asking an anonymous-reachable endpoint which modules
 * are installed just to decide whether to mount a route.
 */
export function usePublicModuleRoutes(): ModuleRouteEntry[] {
  return useMemo(() => {
    const discovered = getAllDiscoveredModuleRoutes();
    const entries: ModuleRouteEntry[] = [];
    for (const routesModule of discovered.values()) {
      if (routesModule.publicRoutes) entries.push(...routesModule.publicRoutes);
    }
    return entries;
  }, []);
}

/**
 * Every INSTALLED module's AUTHENTICATED routes, resolved from the
 * build-time-discovered `routes.tsx` files filtered to only the module keys
 * `manifests` (from `useModuleFrontendManifests`) reports as installed. A
 * module discovered on disk but not installed, or installed but missing on
 * disk (a stale registry row), is silently skipped — never a crash,
 * matching `module-loader.ts`'s own missing-entry-skip behavior on the
 * backend. Unlike public routes, these genuinely need the installed-module
 * list — an authenticated page a reader can't use is a 403 from its own
 * real API calls (D12's philosophy), not a route that shouldn't exist, but
 * a module that was never installed at all shouldn't clutter the
 * authenticated route table (or the sidebar) either.
 */
export function useAuthenticatedModuleRoutes(manifests: FrontendModuleManifest[] | null): ModuleRouteEntry[] {
  return useMemo(() => {
    if (!manifests) return [];
    const discovered = getAllDiscoveredModuleRoutes();
    const entries: ModuleRouteEntry[] = [];
    for (const manifest of manifests) {
      const routesModule = discovered.get(manifest.key);
      if (routesModule?.authenticatedRoutes) entries.push(...routesModule.authenticatedRoutes);
    }
    return entries;
  }, [manifests]);
}
