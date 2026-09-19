import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import * as authApi from '../shared/api/auth';
import { usersApi } from '../shared/api/users';
import { isMustChangePasswordError, onAuthExpired, refreshAccessToken } from '../shared/api/httpClient';
import type { PublicUser } from '../shared/api/types';

export type AuthStatus = 'initializing' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  mustChangePassword: boolean;
  /**
   * The caller's REAL effective permission codes (`GET
   * /users/me/permissions`), fetched once alongside `GET /users/me` and
   * re-fetched on every login/force-password-change completion — never a
   * client-side guess. `null` while still loading (distinct from an empty
   * set) so `hasPermission` can distinguish "not yet known" from "known and
   * denied" — see `shared/permissions.tsx`'s `usePermission` for how that
   * distinction is used to avoid a flash of hidden content before the real
   * grants are known.
   */
  permissions: Set<string> | null;
  hasPermission: (code: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeForcePasswordChange: (newPassword: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session model (ARCHITECTURE.md §6.1, BUILD_PLAN.md Phase 6 item 1): the
 * access token lives ONLY in the httpClient module's in-memory variable
 * (never localStorage) — a page refresh loses it on purpose. On mount, this
 * provider does a SILENT re-auth via the httpOnly refresh cookie
 * (`POST /auth/refresh`, no body) rather than reading anything back off
 * disk; if that fails (no valid cookie, expired session, ...) the app
 * simply starts anonymous and shows the login page.
 *
 * *** A real bug this Developer agent found (and fixed here — apps/web is
 * in scope) while manually testing in a real browser ***: `GET /users/me`
 * is how this provider was meant to learn `mustChangePassword` right after
 * login. But `UsersController` applies `MustChangePasswordGuard` to its
 * WHOLE controller with no `@AllowMustChangePassword()` on `getMe` (unlike
 * `AuthController`'s `logout`/`force-password-change`, which are its
 * explicit escape hatches) — so `/users/me` itself 403s with the
 * must-change-password shape for exactly the account this app most needs
 * to read it for. `loadCurrentUser` below now treats THAT specific 403 as
 * the signal itself (never retries `getMe()` from inside the error path —
 * retrying is what caused the infinite request loop this agent observed
 * and fixed), and `mustChangePassword` is tracked as its own piece of state
 * rather than only ever read off a successfully-fetched `PublicUser`.
 *
 * Real permission-gating (superseding the old client-side "optimistic
 * until a real 403" cache that used to live in `shared/permissions.tsx`):
 * `GET /users/me/permissions` is fetched right after `getMe()` succeeds,
 * giving the whole app the caller's REAL effective grants upfront —
 * `PageLayout`'s sidebar and every route guard now filter against this set
 * directly, so an unauthorized page is never rendered even momentarily
 * (previously it rendered optimistically until its own data call 403'd).
 * Deliberately NOT parallelized with `getMe()` via `Promise.all` — if
 * `getMe()` itself 403s with the must-change-password shape, there is no
 * point fetching permissions at all (the app never renders the sidebar/
 * routes in that state), and doing them sequentially keeps this file's
 * existing, already-tricky control flow easy to follow.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [mustChangePasswordPending, setMustChangePasswordPending] = useState(false);
  const [permissions, setPermissions] = useState<Set<string> | null>(null);

  const loadCurrentUser = useCallback(async () => {
    try {
      const me = await usersApi.getMe();
      setUser(me);
      setMustChangePasswordPending(false);
      setStatus('authenticated');
      const codes = await usersApi.getMyPermissions();
      setPermissions(new Set(codes));
    } catch (error) {
      if (isMustChangePasswordError(error)) {
        // Authenticated (the token/session is valid — JwtAuthGuard already
        // let this request through) but blocked from every other endpoint,
        // including this one, until the password is changed. Record that
        // directly; do NOT call loadCurrentUser() again here.
        setUser(null);
        setMustChangePasswordPending(true);
        setPermissions(null);
        setStatus('authenticated');
        return;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshAccessToken()
      .then(() => loadCurrentUser())
      .catch(() => {
        if (!cancelled) setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — this IS the "silent refresh on page load"
    // behavior, not a per-render effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      onAuthExpired(() => {
        setUser(null);
        setMustChangePasswordPending(false);
        setPermissions(null);
        setStatus('anonymous');
      }),
    [],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      await authApi.login(email, password);
      await loadCurrentUser();
    },
    [loadCurrentUser],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setMustChangePasswordPending(false);
    setPermissions(null);
    setStatus('anonymous');
  }, []);

  const completeForcePasswordChange = useCallback(
    async (newPassword: string) => {
      await authApi.forcePasswordChange(newPassword);
      // The guard now lets `/users/me` through — this call succeeds for
      // real and returns the fresh `mustChangePassword: false` user, then
      // fetches real permissions same as any other successful load.
      await loadCurrentUser();
    },
    [loadCurrentUser],
  );

  const hasPermission = useCallback((code: string) => permissions?.has(code) ?? false, [permissions]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      mustChangePassword: user?.mustChangePassword ?? mustChangePasswordPending,
      permissions,
      hasPermission,
      login,
      logout,
      completeForcePasswordChange,
      refreshUser: loadCurrentUser,
    }),
    [status, user, mustChangePasswordPending, permissions, hasPermission, login, logout, completeForcePasswordChange, loadCurrentUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within <AuthProvider>');
  return ctx;
}
