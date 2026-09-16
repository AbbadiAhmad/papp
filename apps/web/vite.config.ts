import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'node:http';
import { defineConfig } from 'vite';

/**
 * Dev-server proxy for the api's top-level route prefixes.
 *
 * *** Backend gap this works around (reported, not fixed — apps/api/**
 * is out of this Developer agent's scope) ***: `apps/api/src/main.ts` calls
 * `app.enableCors({ credentials: true })` with no `origin` option, so the
 * underlying `cors` package defaults to `Access-Control-Allow-Origin: *`.
 * Per the Fetch/CORS spec, a browser REJECTS a credentialed
 * (`withCredentials: true`) cross-origin response whose ACAO is `*` — it
 * never stores the Set-Cookie and the request fails outright. Since the web
 * app (this dev server, and the built SPA behind `apps/web/nginx.conf` in
 * docker-compose) and the api are always on different origins/ports, the
 * whole cookie-based refresh-token flow (ARCHITECTURE.md §6.1) cannot work
 * against the committed backend as configured, in dev OR in the
 * docker-compose deployment. The real fix belongs in `main.ts`
 * (`enableCors({ origin: <the web app's origin(s)>, credentials: true })`)
 * — flagged in this Developer agent's final report.
 *
 * This proxy makes the browser see same-origin requests during
 * `npm run dev` (so this Developer agent could actually verify the app
 * against a real browser at all), by forwarding every core api path prefix
 * to `VITE_API_URL` server-side. It does NOT paper over the bug for a
 * production build (nginx serves the static SPA with no such proxy — see
 * `apps/web/nginx.conf` — so the built app still calls `VITE_API_URL`
 * directly and still hits the same wall there).
 */
const CORE_API_PATH_PREFIXES = [
  '/auth',
  '/users',
  '/roles',
  '/permissions',
  '/sessions',
  '/audit',
  '/notifications',
  '/settings',
  '/modules',
  '/i18n',
  '/health',
];

/**
 * The core api's route prefixes (`/users`, `/roles`, `/sessions`, ...) are
 * IDENTICAL, by design, to this SPA's own client-side route paths — there's
 * no `/api` prefix on the backend. That means a bare path-based dev proxy
 * would also swallow the browser's own top-level navigation to e.g.
 * `http://localhost:5173/users` (typing the URL directly, or a full page
 * reload) and forward it to the api instead of serving the SPA shell.
 * `bypass` distinguishes the two by `Accept` header — a real page
 * navigation asks for `text/html`; this app's own `fetch`/axios calls never
 * do — and serves `index.html` for the former so React Router (not the
 * proxy) handles it, exactly like `apps/web/nginx.conf` already does for
 * the production build via `try_files ... /index.html`.
 */
function bypassHtmlNavigations(req: IncomingMessage): string | undefined {
  const accept = req.headers.accept ?? '';
  if (accept.includes('text/html')) {
    return '/index.html';
  }
  return undefined;
}

// Read directly from process.env (not vite's loadEnv/mode-callback form) so
// this file stays a plain config OBJECT — vitest.config.ts merges it via
// `mergeConfig`, which cannot merge the function form `defineConfig` returns
// when passed a `(env) => ...` callback. docker-compose/Dockerfile already
// export VITE_API_URL as a real process env var before `vite build` runs
// (see apps/web/Dockerfile's `ENV VITE_API_URL=...`), and `npm run dev`
// works the same way (`VITE_API_URL=... npm run dev`).
const apiTarget = process.env.VITE_API_URL || 'http://localhost:3000';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: Object.fromEntries(
      CORE_API_PATH_PREFIXES.map((prefix) => [
        prefix,
        { target: apiTarget, changeOrigin: true, bypass: bypassHtmlNavigations },
      ]),
    ),
  },
});
