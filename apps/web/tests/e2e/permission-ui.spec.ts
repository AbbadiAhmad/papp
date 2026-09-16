import { expect, test } from '@playwright/test';
import { API_ORIGIN, READER_USER, TEXT } from './support/test-data';

/**
 * Permission-driven UI (docs/TESTING_STRATEGY.md §1's Playwright bullet,
 * item 3): a `reader`-role user cannot reach an admin-only page even by
 * typing the URL directly. `/modules` (permission `modules.view`) is used
 * here — confirmed via the real seeded role_permissions table that `reader`
 * holds neither `modules.view` nor `users.view`, while `admin` holds both.
 *
 * apps/web/src/shared/permissions.tsx's own docblock explains why: there is
 * no client-side "effective permission set" to pre-check against, so the
 * real boundary IS the backend PermissionGuard — QueryStateGate only
 * navigates to /forbidden after the page's own real GET call comes back 403
 * (shared/components/QueryStateGate.tsx). This spec asserts both halves:
 * the real 403 on the wire, and the resulting client-side redirect.
 */
test.describe('Permission-driven UI', () => {
  test('a reader cannot reach the admin-only Modules page, even by typing the URL', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    // A full page navigation (not a SPA link click) — literally "typing the
    // URL directly": the app remounts, AuthProvider silently re-auths via
    // the refresh cookie, and ModulesAdminPage makes its own real GET /modules.
    // Matched against the exact backend origin, not a bare path suffix: the
    // SPA's own page-navigation response for this same `page.goto()` (served
    // by the web server's history-fallback at http://localhost:5173/modules)
    // ALSO ends with "/modules" and resolves first, which would otherwise
    // make this assert against the wrong response entirely.
    const [modulesResponse] = await Promise.all([
      page.waitForResponse((res) => res.url() === `${API_ORIGIN}/modules` && res.request().method() === 'GET'),
      page.goto('/modules'),
    ]);

    // 1. The underlying API call itself is really rejected.
    expect(modulesResponse.status()).toBe(403);
    const body = (await modulesResponse.json()) as { message?: string };
    expect(body.message).toBe('Missing required permission: modules.view');

    // 2. Only AFTER that real rejection does the SPA redirect client-side.
    await page.waitForURL(/\/forbidden$/);
    await expect(page.getByText(TEXT.ar.forbiddenTitle)).toBeVisible();

    // The Modules page's own content never rendered.
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('a reader cannot reach the admin-only Users page, even by typing the URL', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    const [usersResponse] = await Promise.all([
      page.waitForResponse((res) => res.url() === `${API_ORIGIN}/users` && res.request().method() === 'GET'),
      page.goto('/users'),
    ]);
    expect(usersResponse.status()).toBe(403);
    await page.waitForURL(/\/forbidden$/);
  });
});
