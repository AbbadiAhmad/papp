import { expect, test } from '@playwright/test';
import { API_ORIGIN, READER_USER, TEXT } from './support/test-data';

function isApiResponse(response: Response, pathname: string, method = 'GET') {
  try {
    const url = new URL(response.url());
    const api = new URL(API_ORIGIN);
    return (
      url.origin === api.origin &&
      url.pathname.replace(/\/+$/, '') === `${api.pathname.replace(/\/+$/, '')}${pathname}`.replace(/\/+/g, '/') &&
      response.request().method() === method
    );
  } catch {
    return false;
  }
}

/**
 * Permission-driven UI (docs/TESTING_STRATEGY.md §1's Playwright bullet,
 * item 3): a `reader`-role user cannot reach an admin-only page even by
 * typing the URL directly. `/modules` (permission `modules.view`) is used
 * here — confirmed via the real seeded role_permissions table that `reader`
 * holds neither `modules.view` nor `users.view`, while `admin` holds both.
 *
 * `RequirePermissionRoute` (apps/web/src/shared/components/RequirePermissionRoute.tsx)
 * is the real boundary now, not a page's own data call: it gates on the
 * caller's already-loaded `GET /users/me/permissions` result (fetched once
 * by `AuthContext` right after login) and redirects to `/forbidden` BEFORE
 * the wrapped page ever mounts — this is what fixes the older "page
 * renders, its own list call 403s, THEN it redirects" flash that
 * `shared/permissions.tsx`'s docblock describes as the previous design.
 * That means the page's own list endpoint (`GET /modules`, `GET /users`)
 * is never called at all for a denied caller; this spec asserts that
 * (real) absence rather than waiting on a call that no longer happens, and
 * still asserts the actual security boundary the same way — the backend
 * `PermissionGuard` denying `/users/me/permissions`'s underlying grants
 * remains what a stale/mid-session-revoked grant would be caught by,
 * `RequirePermissionRoute`'s own docblock says so explicitly.
 */
test.describe('Permission-driven UI', () => {
  test('a reader cannot reach the admin-only Modules page, even by typing the URL', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    // The real, server-confirmed permission set the redirect below relies on.
    const permissionsResponse = await page.waitForResponse((response) => isApiResponse(response, '/users/me/permissions'));
    expect(permissionsResponse.status()).toBe(200);
    const permissions = (await permissionsResponse.json()) as string[];
    expect(permissions).not.toContain('modules.view');

    let modulesListCalled = false;
    page.on('response', (response) => {
      if (isApiResponse(response, '/modules')) modulesListCalled = true;
    });

    await page.goto('/modules');
    await page.waitForURL(/\/forbidden$/);
    await expect(page.getByText(TEXT.ar.forbiddenTitle)).toBeVisible();

    // The Modules page never mounted — its own list call never fired, and
    // no table (its content) ever rendered.
    expect(modulesListCalled).toBe(false);
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('a reader cannot reach the admin-only Users page, even by typing the URL', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    const permissionsResponse = await page.waitForResponse((response) => isApiResponse(response, '/users/me/permissions'));
    const permissions = (await permissionsResponse.json()) as string[];
    expect(permissions).not.toContain('users.view');

    let usersListCalled = false;
    page.on('response', (response) => {
      if (isApiResponse(response, '/users')) usersListCalled = true;
    });

    await page.goto('/users');
    await page.waitForURL(/\/forbidden$/);

    expect(usersListCalled).toBe(false);
  });
});
