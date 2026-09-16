import { expect, test } from '@playwright/test';
import { INVALID_PASSWORD, READER_USER, TEXT } from './support/test-data';

/**
 * Login flow (docs/TESTING_STRATEGY.md §1's Playwright bullet, item 1):
 * valid credentials reach an authenticated page; invalid credentials show a
 * real (server-produced, not client-guessed) error; logout returns to
 * login. Runs against the app's real default language (Arabic — D6/D8),
 * matching what a fresh, no-localStorage browser actually shows.
 */
test.describe('Login flow', () => {
  test('valid credentials reach an authenticated page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: TEXT.ar.login })).toBeVisible();

    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);

    const [loginResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/auth/login') && res.request().method() === 'POST'),
      page.getByRole('button', { name: TEXT.ar.login }).click(),
    ]);
    expect(loginResponse.status()).toBe(200);

    // Real navigation away from /login, real authenticated shell rendered —
    // the avatar button (aria-label = the real user's name, from a real
    // GET /users/me) and the sidebar are both present, not just "the login
    // form disappeared".
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await expect(page.getByLabel(READER_USER.name, { exact: true })).toBeVisible();
    await expect(page.locator('.MuiDrawer-root')).toBeVisible();
  });

  test('invalid credentials show a real server-produced error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(INVALID_PASSWORD);

    const [loginResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/auth/login') && res.request().method() === 'POST'),
      page.getByRole('button', { name: TEXT.ar.login }).click(),
    ]);
    expect(loginResponse.status()).toBe(401);

    // The exact message the real AuthService throws (auth.service.ts),
    // surfaced verbatim by extractErrorMessage — not a generic client
    // string. The server hardcodes this in English regardless of UI
    // language (verified with a direct curl call before writing this spec).
    await expect(page.getByText(TEXT.en.invalidCredentials)).toBeVisible();
    // Still on the login page — a failed login must not navigate away.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logout returns to the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    // Open the user menu (avatar button, aria-label = the real user's name)
    // then click "Log out".
    await page.getByLabel(READER_USER.name, { exact: true }).click();
    const [logoutResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/auth/logout') && res.request().method() === 'POST'),
      page.getByText(TEXT.ar.logout).click(),
    ]);
    expect(logoutResponse.status()).toBe(200);

    await page.waitForURL(/\/login$/);
    await expect(page.getByRole('button', { name: TEXT.ar.login })).toBeVisible();

    // A real logout, not just a client-side redirect: reloading the app
    // afterwards must NOT silently resume a session (the refresh cookie was
    // actually revoked server-side, not just cleared client-side).
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
  });
});
