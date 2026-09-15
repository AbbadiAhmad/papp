import { defineConfig, devices } from '@playwright/test';

/**
 * Frontend e2e layer (docs/TESTING_STRATEGY.md §1). Config only for now —
 * Phase 0 ships no specs; Phase 6 adds login/force-password-change/
 * permission-driven-UI/language-switch flows once the real app shell and
 * admin screens exist (see docs/BUILD_PLAN.md, Phase 6).
 *
 * `webServer` boots the Vite dev server against the port docker-compose /
 * .env.example already use (see apps/web/vite.config.ts, WEB_PORT), so
 * specs can hit a real running app without a separate manual step.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
