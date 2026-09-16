import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren, type ReactNode } from 'react';
import { isForbiddenError } from './api/httpClient';

/**
 * Permission-gating design decision (see this Developer agent's final
 * report for the full write-up):
 *
 * ARCHITECTURE.md §7.2/BUILD_PLAN.md Phase 6 call for a `usePermission(code)`
 * hook backed by "the caller's effective permissions" fetched once and
 * cached. The committed backend (Phases 0-5) exposes NO such endpoint —
 * there is no `GET /permissions/me/effective`, and `GET /users/me` returns
 * no role/permission info (checked: users.controller.ts, permissions.
 * controller.ts, roles.controller.ts — every listing endpoint is itself
 * gated by a real permission code, so even "list my roles" needs
 * `roles.view`, which a low-privilege user by definition may not hold).
 *
 * Inventing a client-side "effective permission set" from nothing would
 * mean either (a) guessing/hardcoding role->permission defaults (exactly
 * the kind of fake local permission list CLAUDE.md/SKILL.md warn against,
 * and it WOULD drift from whatever an admin actually grants at runtime), or
 * (b) calling a mutating endpoint just to see if it 403s (unacceptable —
 * that create/delete/grant call would have a real side effect).
 *
 * So this hook takes the literal fallback the task spec allows: permission
 * state is learned ONLY from a REAL API call's outcome, never precomputed.
 * Concretely:
 *   - Every page that needs `<code>.view` makes its own real GET call to
 *     render at all; a 403 from THAT call is reported here and the page
 *     shows a Forbidden state (see ForbiddenNotice/ProtectedPage).
 *   - Every mutating action (create/update/delete/grant/send/...) is wrapped
 *     in `runGated(code, fn)` below: it performs the REAL call; a 403
 *     reports `code` as denied and the control disappears from then on for
 *     the rest of the session (cleared on login/logout, see AuthProvider's
 *     `resetPermissionGate` call).
 *   - Until a code has been confirmed denied, every gated control is shown
 *     OPTIMISTICALLY (never pre-hidden from a guessed list) — clicking it
 *     performs the real backend check, which remains the actual security
 *     boundary regardless of what the UI shows.
 *
 * This is a real, deliberate fork from "cache a fetched effective-permission
 * set" — flagged explicitly per CLAUDE.md's "flag assumptions" rule.
 */

interface PermissionGateContextValue {
  isDenied: (code: string) => boolean;
  reportOutcome: (code: string, allowed: boolean) => void;
  reset: () => void;
}

const PermissionGateContext = createContext<PermissionGateContextValue | null>(null);

export function PermissionGateProvider({ children }: PropsWithChildren): ReactNode {
  const [deniedCodes, setDeniedCodes] = useState<Record<string, boolean>>({});

  const reportOutcome = useCallback((code: string, allowed: boolean) => {
    setDeniedCodes((prev) => {
      const nextDenied = !allowed;
      if (prev[code] === nextDenied) return prev;
      return { ...prev, [code]: nextDenied };
    });
  }, []);

  const reset = useCallback(() => setDeniedCodes({}), []);

  const value = useMemo<PermissionGateContextValue>(
    () => ({
      isDenied: (code) => deniedCodes[code] === true,
      reportOutcome,
      reset,
    }),
    [deniedCodes, reportOutcome, reset],
  );

  return <PermissionGateContext.Provider value={value}>{children}</PermissionGateContext.Provider>;
}

function usePermissionGateContext(): PermissionGateContextValue {
  const ctx = useContext(PermissionGateContext);
  if (!ctx) throw new Error('usePermission()/<Can> must be rendered inside <PermissionGateProvider>');
  return ctx;
}

/**
 * UX convenience only (ARCHITECTURE.md §7.2) — true until proven otherwise
 * by a real 403 from the matching backend endpoint. The backend
 * PermissionGuard is always the actual boundary; this only controls whether
 * a control is shown/enabled.
 */
export function usePermission(code: string): boolean {
  const { isDenied } = usePermissionGateContext();
  return !isDenied(code);
}

export function Can({ permission, children }: { permission: string; children: ReactNode }): ReactNode {
  const allowed = usePermission(permission);
  return allowed ? children : null;
}

export function useResetPermissionGate(): () => void {
  const { reset } = usePermissionGateContext();
  return reset;
}

/**
 * Wraps a real API call with permission-outcome reporting: success reports
 * `code` as allowed (in case an earlier optimistic-denial needs clearing —
 * e.g. an admin who granted themselves the code mid-session and retries),
 * a 403 reports it denied and the error is re-thrown for the caller's own
 * error handling (a snackbar, a form error, etc).
 */
export function useGatedCall(): <T>(code: string, fn: () => Promise<T>) => Promise<T> {
  const { reportOutcome } = usePermissionGateContext();
  return useCallback(
    async <T,>(code: string, fn: () => Promise<T>): Promise<T> => {
      try {
        const result = await fn();
        reportOutcome(code, true);
        return result;
      } catch (error) {
        if (isForbiddenError(error)) {
          reportOutcome(code, false);
        }
        throw error;
      }
    },
    [reportOutcome],
  );
}

export function useReportPermissionOutcome(): (code: string, allowed: boolean) => void {
  const { reportOutcome } = usePermissionGateContext();
  return reportOutcome;
}
