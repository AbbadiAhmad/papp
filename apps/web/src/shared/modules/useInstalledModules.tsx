import { useEffect, useMemo, useState } from 'react';
import { modulesApi } from '../api/modules';
import { RequirePermissionRoute } from '../components/RequirePermissionRoute';
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
// Survives the route-tree remount App.tsx's GuardedAppRoutes does on every navigation
// (`key={pathname}`): without it each click starts from `null` -> no module routes -> the catch-all
// 404 page flashes until the manifest request returns. Still refetched on every mount so an
// install/uninstall is picked up; cleared when the session ends (`enabled` goes false).
let cachedManifests: FrontendModuleManifest[] | null = null;

export function useModuleFrontendManifests(enabled: boolean): FrontendModuleManifest[] | null {
  const [manifests, setManifests] = useState<FrontendModuleManifest[] | null>(cachedManifests);

  useEffect(() => {
    if (!enabled) {
      cachedManifests = null;
      return;
    }
    let cancelled = false;
    modulesApi
      .getFrontendManifest()
      .then((result) => {
        cachedManifests = result;
        if (!cancelled) setManifests(result);
      })
      .catch(() => {
        if (!cancelled) setManifests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // `!enabled` reports `null` directly at read time rather than clearing
  // `manifests` via a synchronous setState inside the effect above (which
  // eslint's react-hooks/set-state-in-effect rule flags as an avoidable
  // extra render) — this hook already treats "disabled" and "no manifests
  // yet" identically to every caller, so there is nothing lost by not
  // actually resetting the underlying state: the moment `enabled` flips
  // back to true, the effect re-fetches and overwrites it anyway.
  return enabled ? manifests : null;
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
 * backend.
 *
 * Each route's `element` is wrapped in `RequirePermissionRoute`, matched
 * against that module's OWN manifest `routes[]` entry by `pattern === path`
 * — the manifest is the authoritative source for a route's
 * `requiredPermission` (validated at install time against the module's
 * declared `permissions[]`), never re-declared in the `.tsx` file itself.
 * This is what makes a module page (e.g. library_circulation's ScanPage)
 * behave the same as a core page: an unauthorized user is redirected to
 * `/forbidden` before the page ever mounts, not after its own API call
 * 403s. A route with no matching manifest entry (shouldn't happen — install
 * validation requires every `.tsx`-side route to have a manifest entry, but
 * defensive here the same way `module-loader.ts` treats a malformed module)
 * renders unwrapped (`code: null`) rather than crashing.
 */
export function useAuthenticatedModuleRoutes(manifests: FrontendModuleManifest[] | null): ModuleRouteEntry[] {
  return useMemo(() => {
    if (!manifests) return [];
    const discovered = getAllDiscoveredModuleRoutes();
    const entries: ModuleRouteEntry[] = [];
    for (const manifest of manifests) {
      const routesModule = discovered.get(manifest.key);
      if (!routesModule?.authenticatedRoutes) continue;
      for (const route of routesModule.authenticatedRoutes) {
        const manifestRoute = manifest.routes.find((r) => r.pattern === route.path);
        const requiredPermission = manifestRoute?.requiredPermission ?? null;
        entries.push({
          path: route.path,
          element: <RequirePermissionRoute code={requiredPermission}>{route.element}</RequirePermissionRoute>,
        });
      }
    }
    return entries;
  }, [manifests]);
}
