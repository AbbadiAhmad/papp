import { useCallback, useEffect, useRef, useState } from 'react';
import { isForbiddenError, isUnauthorizedError, extractErrorMessage } from '../api/httpClient';

export type GuardedQueryStatus = 'loading' | 'ready' | 'forbidden' | 'error';

export interface GuardedQueryResult<T> {
  status: GuardedQueryStatus;
  data: T | undefined;
  errorMessage: string | null;
  reload: () => void;
}

/**
 * Performs the REAL backend call a "list/view" page needs anyway, and
 * turns a 403 into a `forbidden` status the page renders as a redirect via
 * `QueryStateGate` (see that component). Route-level permission guarding
 * (`RequirePermissionRoute` in App.tsx, backed by `AuthContext`'s real
 * `GET /users/me/permissions` fetch) is what actually prevents an
 * unauthorized page from rendering at all now — this hook's `forbidden`
 * status is a live-backend-rejection safety net for the rarer case where
 * client-side permission state is stale (e.g. a grant was revoked
 * mid-session, before the next full permission refresh), not the primary
 * gating mechanism the way it used to be. (Superseded: this hook used to
 * also report every outcome into a client-side "confirmed denied by a real
 * 403" cache via a `permissionCode` parameter — removed now that real
 * permission state is known upfront; see `shared/permissions.tsx`.)
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
export function useGuardedQuery<T>(fetcher: () => Promise<T>): GuardedQueryResult<T> {
  const [status, setStatus] = useState<GuardedQueryStatus>('loading');
  const [data, setData] = useState<T | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
        setData(result);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isForbiddenError(error)) {
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
  }, [reloadToken]);

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
