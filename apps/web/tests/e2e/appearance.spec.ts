import { expect, test, type Page } from '@playwright/test';
import { SURVEY_ADMIN_USER, TEXT } from './support/test-data';

/**
 * Appearance (D95-D99): an admin switches to the child-friendly "School Blue" theme, which replaces the permanent
 * sidebar with top tabs, and the per-device dark mode toggle repaints the page. Always puts the built-in theme back,
 * because the other specs expect the sidebar shell.
 */
const ACTIVATE = 'استخدم هذا التصميم'; // core.appearance.activate (ar)
const COLOR_MODE_BUTTON = /المظهر:/; // core.common.colorMode.* (ar), the top-bar toggle

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel(TEXT.ar.email).fill(SURVEY_ADMIN_USER.email);
  await page.getByLabel(TEXT.ar.password).fill(SURVEY_ADMIN_USER.password);
  await page.getByRole('button', { name: TEXT.ar.login }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('Appearance', () => {
  test('switching to School Blue shows top tabs instead of the sidebar, and dark mode repaints the page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/appearance');

    // Built-in theme first: permanent sidebar, no tabs.
    await expect(page.locator('.MuiDrawer-root.MuiDrawer-docked')).toBeVisible();
    await expect(page.locator('[data-app-shell="tabs"]')).toHaveCount(0);

    try {
      // Cards are ordered default, school_blue, template_theme; the active one has no button, so the first button is School Blue.
      const [activeResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/appearance/active-theme') && res.request().method() === 'PUT'),
        page.getByRole('button', { name: ACTIVATE }).first().click(),
      ]);
      expect(activeResponse.status()).toBe(200);

      await expect(page.locator('[data-app-shell="tabs"]')).toBeVisible();
      await expect(page.locator('.MuiDrawer-root.MuiDrawer-docked')).toHaveCount(0);

      // system -> light -> dark; School Blue's dark background is #101B3A.
      await page.getByRole('button', { name: COLOR_MODE_BUTTON }).click();
      await page.getByRole('button', { name: COLOR_MODE_BUTTON }).click();
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
        .toBe('rgb(16, 27, 58)');
    } finally {
      // Restore the built-in sidebar theme for every other spec: it is the first card, and now has an Activate button.
      await Promise.all([
        page.waitForResponse((res) => res.url().includes('/appearance/active-theme') && res.request().method() === 'PUT'),
        page.getByRole('button', { name: ACTIVATE }).first().click(),
      ]);
      await expect(page.locator('.MuiDrawer-root.MuiDrawer-docked')).toBeVisible();
    }
  });
});
