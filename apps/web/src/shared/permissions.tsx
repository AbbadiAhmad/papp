import { useCallback, type ReactNode } from 'react';
import { useAuth } from '../app/AuthContext';

/**
 * Real permission gating (root DECISIONS.md — supersedes the earlier
 * "optimistic until a real 403" client cache this file used to implement).
 *
 * That earlier design existed because the committed backend had no
 * "caller's effective permissions" endpoint at all (every listing endpoint
 * was itself gated, so even "list my own roles" needed `roles.view`, which
 * a low-privilege caller might not hold) — inventing one client-side would
 * have meant guessing/hardcoding role->permission defaults that drift from
 * whatever an admin actually grants at runtime. `GET /users/me/permissions`
 * (backed by the same `PermissionsService.getEffectivePermissionCodes` the
 * backend's own landing-page-options logic already used internally) closes
 * that gap for real: `AuthContext` fetches it once right after login and
 * exposes it as `permissions`/`hasPermission`, so this file is now a thin
 * wrapper around real, server-confirmed state instead of a client-side
 * cache of past 403s.
 *
 * The backend `PermissionGuard` remains the actual security boundary
 * regardless of what this shows — a stale/mid-session-revoked grant would
 * still be correctly rejected server-side; this only controls what the UI
 * renders.
 */

/**
 * `true`/`false` once the caller's real permission set has loaded; `false`
 * (hidden) during the brief window before it has — never `true` by
 * default, so a control/page a role doesn't hold is never shown even
 * momentarily (this is the fix for "an unauthorized page briefly renders
 * before redirecting to Forbidden").
 */
export function usePermission(code: string): boolean {
  const { hasPermission } = useAuth();
  return hasPermission(code);
}

/** `true` once the caller's real permission set has loaded — lets a route guard distinguish "still loading" from "loaded and denied" (see `RequirePermissionRoute`). */
export function usePermissionsLoaded(): boolean {
  const { permissions } = useAuth();
  return permissions !== null;
}

export function Can({ permission, children }: { permission: string; children: ReactNode }): ReactNode {
  const allowed = usePermission(permission);
  return allowed ? children : null;
}

/**
 * Wraps a mutating action with no extra bookkeeping beyond what the call
 * itself already does — the permission state driving `usePermission`/`Can`
 * is already real (fetched upfront), so there is nothing left to "learn"
 * from an action's outcome the way the old cache-based `useGatedCall` did.
 * Kept as a thin passthrough (rather than deleted outright) so every
 * existing `gated(code, fn)` call site needs no rewrite — `code` is
 * accepted and ignored.
 */
export function useGatedCall(): <T>(code: string, fn: () => Promise<T>) => Promise<T> {
  return useCallback(<T,>(_code: string, fn: () => Promise<T>): Promise<T> => fn(), []);
}
