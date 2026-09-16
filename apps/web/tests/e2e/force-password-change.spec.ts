import { expect, test } from '@playwright/test';
import { resetForcePasswordChangeFixture } from './support/db';
import { FORCE_PASSWORD_CHANGE_USER, TEXT } from './support/test-data';

/**
 * Force-password-change flow (docs/TESTING_STRATEGY.md §1's Playwright
 * bullet, item 2 / ARCHITECTURE.md §6.1): a user with
 * must_change_password=true is routed to /force-password-change on login
 * and cannot reach any other page — even by typing a URL directly — until
 * it completes; afterwards normal navigation works.
 *
 * Reset to the seeded "must change" state before every test so the spec is
 * idempotent across repeated local runs (the password genuinely changes
 * server-side during the third test).
 */
test.describe('Force password change flow', () => {
  test.beforeEach(() => {
    resetForcePasswordChangeFixture();
  });

  test('a must-change-password account is routed to the change-password screen on login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(FORCE_PASSWORD_CHANGE_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(FORCE_PASSWORD_CHANGE_USER.tempPassword);

    // Both waiters are registered BEFORE the click that triggers them —
    // AuthContext fires GET /users/me immediately after POST /auth/login
    // resolves, so waiting for it only after the login response would race
    // (it can already have completed by then).
    const [loginResponse, meResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/auth/login') && res.request().method() === 'POST'),
      // AuthContext.loadCurrentUser's real GET /users/me — users.controller.ts
      // marks `getMe()` `@AllowMustChangePassword()` (Phase 6, its own
      // docblock explains why: gating it too would create an infinite retry
      // loop, since it's the frontend's only way to LEARN mustChangePassword
      // is true in the first place). So this call succeeds (200) even for a
      // must-change-password account — the real signal is the `mustChangePassword`
      // field in its response body, asserted below.
      page.waitForResponse((res) => res.url().includes('/users/me') && res.request().method() === 'GET'),
      page.getByRole('button', { name: TEXT.ar.login }).click(),
    ]);
    expect(loginResponse.status()).toBe(200);
    expect(meResponse.status()).toBe(200);
    const meBody = (await meResponse.json()) as { mustChangePassword?: boolean };
    expect(meBody.mustChangePassword).toBe(true);

    await page.waitForURL(/\/force-password-change$/);
    await expect(page.getByText(TEXT.ar.mustChangePassword)).toBeVisible();
    await expect(page.getByRole('heading', { name: TEXT.ar.changePassword })).toBeVisible();
  });

  test('cannot navigate elsewhere (even by typing a URL) until the password is changed', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(FORCE_PASSWORD_CHANGE_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(FORCE_PASSWORD_CHANGE_USER.tempPassword);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL(/\/force-password-change$/);

    // Typing another authenticated route directly — a full navigation, not
    // client-side routing — must still land back on force-password-change
    // (App.tsx's mustChangePassword branch only ever mounts
    // /force-password-change + public routes; everything else is a
    // wildcard redirect back here).
    await page.goto('/library/books');
    await page.waitForURL(/\/force-password-change$/);
    await expect(page.getByRole('heading', { name: TEXT.ar.changePassword })).toBeVisible();

    await page.goto('/users');
    await page.waitForURL(/\/force-password-change$/);

    await page.goto('/');
    await page.waitForURL(/\/force-password-change$/);
  });

  test('completing the change unblocks normal navigation', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(FORCE_PASSWORD_CHANGE_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(FORCE_PASSWORD_CHANGE_USER.tempPassword);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL(/\/force-password-change$/);

    await page.getByLabel(TEXT.ar.newPassword).fill(FORCE_PASSWORD_CHANGE_USER.newPassword);
    await page.getByLabel(TEXT.ar.confirmPassword).fill(FORCE_PASSWORD_CHANGE_USER.newPassword);

    // Same up-front-registration reasoning as above: completeForcePasswordChange
    // awaits the POST, then immediately re-fetches /users/me.
    const [changeResponse, meResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/auth/force-password-change') && res.request().method() === 'POST',
      ),
      // AuthContext re-fetches /users/me; this time it succeeds for real
      // (mustChangePassword now false) and the app renders the
      // authenticated shell — real navigation, not a stubbed state flip.
      page.waitForResponse((res) => res.url().includes('/users/me') && res.request().method() === 'GET'),
      page.getByRole('button', { name: TEXT.ar.save }).click(),
    ]);
    expect(changeResponse.status()).toBe(200);
    expect(meResponse.status()).toBe(200);
    await expect(page.getByLabel(FORCE_PASSWORD_CHANGE_USER.name, { exact: true })).toBeVisible();

    // Normal navigation now works: typing an authenticated route directly
    // reaches it instead of bouncing back to /force-password-change.
    // (BooksListPage.tsx renders its title as MUI Typography variant="h5",
    // which maps to a real <h5> element.)
    await page.goto('/library/books');
    await page.waitForURL(/\/library\/books$/);
    await expect(page.getByRole('heading', { level: 5 })).toBeVisible();
  });
});
