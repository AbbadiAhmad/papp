import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

/**
 * Base URL the SPA calls the api on. In `npm run dev`, this is deliberately
 * EMPTY (relative requests) so they go through vite.config.ts's dev-server
 * proxy — same-origin from the browser's point of view — instead of
 * `VITE_API_URL` directly; see that file's docblock for the real backend
 * CORS bug this works around (reported, not fixed — out of this Developer
 * agent's apps/api/** scope). The production build (served statically by
 * nginx, no such proxy — apps/web/nginx.conf) still calls `VITE_API_URL`
 * directly and still hits that bug there.
 */
export const API_BASE_URL = import.meta.env.DEV ? '' : ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000');

// --- Access token: IN MEMORY ONLY (ARCHITECTURE.md §6.1) --------------------
// Never localStorage/sessionStorage — a page refresh must trigger a silent,
// cookie-based re-auth (see AuthProvider), not read a token back off disk.
let currentAccessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  currentAccessToken = token;
}

export function getAccessToken(): string | null {
  return currentAccessToken;
}

type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

/** AuthProvider subscribes here to clear its own state when a refresh-after-401 fails. */
export function onAuthExpired(listener: AuthExpiredListener): () => void {
  authExpiredListeners.add(listener);
  return () => authExpiredListeners.delete(listener);
}

function notifyAuthExpired(): void {
  for (const listener of authExpiredListeners) listener();
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  // The refresh token travels as an httpOnly cookie scoped to /auth
  // (AuthController.setRefreshCookie) — this is what makes the browser send
  // it back on POST /auth/refresh without any JS ever touching it.
  withCredentials: true,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (currentAccessToken) {
    config.headers.set('Authorization', `Bearer ${currentAccessToken}`);
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

/**
 * De-duplicated refresh: at most one `POST /auth/refresh` in flight at a
 * time. This matters because the refresh token ROTATES on every use
 * (AuthService.refresh) — two concurrent refresh calls would both read the
 * same current cookie, the first would rotate it, and the second would then
 * look like a REUSE of an already-rotated token, which revokes the entire
 * session (theft-detection, ARCHITECTURE.md §6.1 point 4). Every caller
 * (the 401 retry below, and AuthProvider's page-load silent re-auth) shares
 * this single in-flight promise instead.
 */
export function refreshAccessToken(): Promise<string> {
  refreshPromise ??= axios
    .post<{ accessToken: string }>(
      '/auth/refresh',
      {},
      { baseURL: API_BASE_URL, withCredentials: true },
    )
    .then((response) => {
      setAccessToken(response.data.accessToken);
      return response.data.accessToken;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

const AUTH_ENDPOINTS_NEVER_RETRIED = ['/auth/login', '/auth/refresh', '/auth/register'];

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retriedAfterRefresh?: boolean;
}

/**
 * On a 401 from anything OTHER than the auth endpoints themselves: try
 * `POST /auth/refresh` once (cookie-based, no body) and retry the original
 * request with the freshly-issued access token; if the refresh itself fails,
 * clear the in-memory token and notify AuthProvider so the app redirects to
 * /login (ARCHITECTURE.md §6.1 / BUILD_PLAN.md Phase 6 item 1).
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';
    const isAuthEndpoint = AUTH_ENDPOINTS_NEVER_RETRIED.some((path) => url.includes(path));

    if (status === 401 && config && !config._retriedAfterRefresh && !isAuthEndpoint) {
      config._retriedAfterRefresh = true;
      try {
        const token = await refreshAccessToken();
        config.headers.set('Authorization', `Bearer ${token}`);
        return await apiClient.request(config);
      } catch (refreshError) {
        setAccessToken(null);
        notifyAuthExpired();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

// --- Error-shape helpers -----------------------------------------------------
// NestJS's default exception filter returns { statusCode, message, error },
// where `message` is a string (most handlers) or string[] (class-validator).

interface NestErrorBody {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  issues?: Array<{ path: string; message: string }>;
}

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as NestErrorBody | undefined;
    if (body?.message) {
      return Array.isArray(body.message) ? body.message.join(', ') : body.message;
    }
    if (body?.issues?.length) {
      return body.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isForbiddenError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 403;
}

export function isUnauthorizedError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

export function isNotFoundError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/**
 * MustChangePasswordGuard's exact response shape (see its docblock):
 * `ForbiddenException('Password change required before continuing')` ->
 * `{ statusCode: 403, message: 'Password change required before continuing', error: 'Forbidden' }`.
 */
export function isMustChangePasswordError(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) return false;
  const body = error.response.data as NestErrorBody | undefined;
  return typeof body?.message === 'string' && body.message.includes('Password change required');
}
