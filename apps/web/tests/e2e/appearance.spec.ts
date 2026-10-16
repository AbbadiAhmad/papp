import { expect, test, type Page } from '@playwright/test';
import { SURVEY_ADMIN_USER, TEXT } from './support/test-data';

/**
 * Appearance (D95-D99): an admin switches to the child-friendly "School Blue" theme, which replaces the permanent
 * sidebar with top tabs, and the per-device dark mode toggle repaints the page. Always puts the built-in theme back,
 * because the other specs expect the sidebar shell.
 */
const ACTIVATE = 'استخدم هذا التصميم'; // core.appearance.activate (ar)
const COLOR_MODE_BUTTON = /المظهر:/; // core.common.colorMode.* (ar), the top-bar toggle
// Theme cards are found by NAME, never by position: installing another pack must not change what a spec activates.
const SCHOOL_BLUE_NAME = 'مكتبة الأطفال'; // themes/school_blue/theme.json name.ar
const BUILT_IN_NAME = 'الافتراضي'; // BUILT_IN_THEME name.ar
const activateButton = (page: Page, themeName: string) =>
  page.locator('.MuiCard-root', { hasText: themeName }).getByRole('button', { name: ACTIVATE });

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
      const [activeResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/appearance/active-theme') && res.request().method() === 'PUT'),
        activateButton(page, SCHOOL_BLUE_NAME).click(),
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
      // Restore the built-in sidebar theme for every other spec (it now has an Activate button).
      await Promise.all([
        page.waitForResponse((res) => res.url().includes('/appearance/active-theme') && res.request().method() === 'PUT'),
        activateButton(page, BUILT_IN_NAME).click(),
      ]);
      await expect(page.locator('.MuiDrawer-root.MuiDrawer-docked')).toBeVisible();
    }
  });
});
