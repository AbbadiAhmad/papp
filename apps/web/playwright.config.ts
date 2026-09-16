import { defineConfig, devices } from '@playwright/test';

/**
 * Frontend e2e layer (docs/TESTING_STRATEGY.md §1/§0 D37, Tier 2). Phase 9
 * fills in the real specs; this config boots a REAL api + a REAL served web
 * bundle so they run against a genuinely running app + Postgres, not mocks.
 *
 * *** Why `vite preview` (a built bundle) rather than `npm run dev` ***:
 * `vite.config.ts`'s dev-server proxy only forwards a fixed allowlist of
 * top-level path prefixes (`CORE_API_PATH_PREFIXES`) — it does NOT include
 * `/api`, which is exactly where the library_catalog module's routes live
 * (`/api/library/books`, manifest.json `apiPrefix`). Verified live: through
 * `npm run dev`'s proxy, `GET /api/library/books` 404s (no matching proxy
 * rule), which would silently break every Library Catalog e2e spec. This is
 * a real gap in `apps/web/vite.config.ts` (out of this Tester agent's
 * scope — see its final report) that the dev-server proxy exists to work
 * around a DIFFERENT, already-fixed problem (main.ts now calls
 * `enableCors({ origin: webOrigins, credentials: true })`, not a wildcard).
 * With that CORS bug already fixed, a built bundle (`vite build` +
 * `vite preview`) calling `VITE_API_URL` directly — no proxy involved at
 * all — is both simpler and closer to the real docker-compose/nginx
 * deployment shape. Confirmed working end-to-end (login cookie flow
 * included) before writing the specs.
 *
 * *** CI gap (flagged, not fixed — `.github/workflows/ci.yml` is out of
 * this agent's write scope) ***: the `frontend-e2e` job currently has no
 * Postgres service and never boots the api (it only ever ran
 * `--pass-with-no-tests` against zero specs). Now that real specs exist,
 * that job needs the same `services: postgres:` block
 * `backend-integration`/`backend-e2e` already use, plus a step building
 * apps/api and letting this config's `webServer` boot it (or booting it
 * itself before `playwright test`) — otherwise these specs will fail in CI
 * for lack of a backend, not because of anything wrong with the specs
 * themselves. The orchestrator should route this to whoever owns
 * `ci.yml` next.
 */
const API_PORT = process.env.PW_API_PORT ?? '3100';
const API_URL = `http://localhost:${API_PORT}`;
const WEB_PORT = process.env.PW_WEB_PORT ?? '5173';
const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${WEB_PORT}`;

// Matches .env.example's shape; a real deployment always overrides these,
// and CI (once wired up per the gap above) would supply its own via the
// `postgres:` service + a real JWT_SECRET the same way the backend jobs do.
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://papp:papp@localhost:5432/papp?schema=public';
const JWT_SECRET = process.env.JWT_SECRET ?? 'playwright-e2e-not-a-real-secret-see-env-example';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Tier 2 specs share real fixture rows/accounts in one Postgres (see
  // tests/e2e/support/{test-data,db}.ts) — running spec FILES in parallel
  // workers is safe (each logs in as its own account and touches its own
  // rows), but forcing everything onto one worker avoids any doubt about
  // interleaved requests against the same session/cookie jar.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // This sandbox's pre-installed Chromium revision (1194) predates
        // what the pinned @playwright/test 1.63.0 expects by default
        // (1243) — chromium.download() for 1243 is network-blocked here
        // (cdn.playwright.dev, outside the sandbox's egress allowlist).
        // Pointing at the real pre-installed binary is the sandbox-local
        // equivalent of `npx playwright install`; CI (which DOES run
        // `playwright install --with-deps chromium` per ci.yml) needs no
        // such override and should leave this env var unset.
        launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  webServer: [
    {
      // `npm run build` here is apps/api's OWN build script (`nest build`,
      // this webServer entry's cwd), which does NOT build `@papp/shared-types`
      // first the way the ROOT `npm run build` does (D58) — so that's built
      // explicitly first. `e2e-fixtures-bootstrap.js` (docs/DECISIONS.md D59
      // follow-up) then installs library_catalog + seeds the fixture users/
      // book this suite's specs log in as/assert on, and — critically — runs
      // BEFORE `node dist/main.js` starts: D15 means a module only mounts at
      // NestFactory time, so installing it into an ALREADY-running process
      // would never make its routes appear. Running the bootstrap first and
      // the real long-running server last (the only step Playwright's own
      // `url` health check actually waits on) guarantees the server that
      // check passes for has already seen the install by the time it boots.
      command:
        'npm run build --workspace=@papp/shared-types && npm run build && ' +
        'node dist/scripts/e2e-fixtures-bootstrap.js && node dist/main.js',
      cwd: '../api',
      url: `${API_URL}/health`,
      // Locally this Tester agent already has a real api+db running
      // (see its final report) — reused instead of rebuilt/restarted.
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        DATABASE_URL,
        PORT: API_PORT,
        JWT_SECRET,
        WEB_ORIGIN: WEB_URL,
      },
    },
    {
      command: `npm run build && npx vite preview --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        // Baked into the built bundle at build time (Vite inlines
        // import.meta.env.VITE_* at build, not read at runtime) — must
        // point at the SAME api instance the webServer entry above boots.
        VITE_API_URL: API_URL,
      },
    },
  ],
});
