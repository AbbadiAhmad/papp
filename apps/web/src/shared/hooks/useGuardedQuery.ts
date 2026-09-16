import { useCallback, useEffect, useRef, useState } from 'react';
import { isForbiddenError, isUnauthorizedError, extractErrorMessage } from '../api/httpClient';
import { useReportPermissionOutcome } from '../permissions';

export type GuardedQueryStatus = 'loading' | 'ready' | 'forbidden' | 'error';

export interface GuardedQueryResult<T> {
  status: GuardedQueryStatus;
  data: T | undefined;
  errorMessage: string | null;
  reload: () => void;
}

/**
 * The real gate for every "list/view" page (Users, Roles, Permissions
 * catalog, Sessions, Audit, Modules, ...): performs the REAL backend call
 * the page needs anyway, and turns a 403 into a `forbidden` status the page
 * renders as an inline Forbidden notice / redirect — never a pre-computed
 * guess about what the caller can do (see shared/permissions.tsx's
 * docblock for the full reasoning). Also reports the outcome into the
 * permission-gate cache under `permissionCode`, so `usePermission`/`<Can>`
 * elsewhere on the page (e.g. hiding an "Add" button once the list itself
 * is known-forbidden) reflect a REAL, not guessed, outcome.
 *
 * Deliberately never calls `setState` synchronously from inside the effect
 * that triggers a (re)fetch — only from `reload()` itself (invoked by a
 * caller's event handler, never from this hook's own effect) and from the
 * fetch promise's `.then`/`.catch` callbacks. The initial 'loading' state is
 * simply this hook's default `useState` value, so the very first fetch
 * needs no synchronous reset either. `fetcher`'s latest closure is read
 * through a ref (updated in its own post-render effect, never mutated
 * during render) so callers can pass a plain inline arrow every render
 * without retriggering the effect — only `reload()` does that.
 */
export function useGuardedQuery<T>(permissionCode: string | null, fetcher: () => Promise<T>): GuardedQueryResult<T> {
  const [status, setStatus] = useState<GuardedQueryStatus>('loading');
  const [data, setData] = useState<T | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reportOutcome = useReportPermissionOutcome();
  const [reloadToken, setReloadToken] = useState(0);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;

    fetcherRef.current()
      .then((result) => {
        if (cancelled) return;
        if (permissionCode) reportOutcome(permissionCode, true);
        setData(result);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isForbiddenError(error)) {
          if (permissionCode) reportOutcome(permissionCode, false);
          setStatus('forbidden');
          return;
        }
        if (isUnauthorizedError(error)) {
          // The 401-retry-refresh dance already happened in the interceptor;
          // reaching here means refresh also failed — AuthProvider's
          // onAuthExpired listener handles the redirect to /login.
          setStatus('error');
          setErrorMessage(extractErrorMessage(error));
          return;
        }
        setStatus('error');
        setErrorMessage(extractErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [permissionCode, reportOutcome, reloadToken]);

  const reload = useCallback(() => {
    // Called from a caller's event handler (a Retry button, a filter-change
    // effect elsewhere) — never from THIS hook's own effect — so resetting
    // state here synchronously is the normal "respond to an event" case,
    // not the "setState synchronously inside an effect body" one.
    setStatus('loading');
    setErrorMessage(null);
    setReloadToken((t) => t + 1);
  }, []);

  return { status, data, errorMessage, reload };
}
