import { expect, test } from '@playwright/test';
import { READER_USER, SEEDED_BOOK_TITLE, TEXT } from './support/test-data';

/** No Eastern Arabic-Indic digit (٠-٩, U+0660-0669) anywhere in the string — D6/CLAUDE.md rule 4. */
function hasNoEasternArabicDigits(text: string): boolean {
  return !/[٠-٩]/.test(text);
}

/**
 * Language switch / RTL-LTR (docs/TESTING_STRATEGY.md §1's Playwright
 * bullet, item 4; §5 "component test... in both ar/en" is Tier 1 — this is
 * the Tier 2 counterpart against a REAL rendered page). Confirms:
 *  - switching language flips `<html dir>` both ways on a real page;
 *  - the sidebar actually mirrors sides (not just a CSS class toggling with
 *    no visible effect — apps/web/src/shared/components/PageLayout.tsx's
 *    own docblock documents a real regression this exact check would have
 *    caught: `anchor` toggling on top of the RTL emotion cache double-flips
 *    the drawer back to the wrong side);
 *  - numbers/dates on a real page stay Latin-digit/Gregorian in the Arabic UI
 *    (format.ts's `numberingSystem: 'latn'` pin — asserted here as OBSERVED
 *    DOM text, not by calling formatDate directly like the Tier 1 test does).
 */
test.describe('Language switch / RTL', () => {
  test('default Arabic UI is RTL with the sidebar mirrored to the right', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const drawerBox = await page.locator('.MuiDrawer-paper').boundingBox();
    expect(drawerBox).not.toBeNull();
    // Mirrored to the physical right edge in RTL (stylis-plugin-rtl flips
    // the drawer's `left:0` CSS to `right:0` — see PageLayout.tsx).
    expect(drawerBox!.x + drawerBox!.width).toBeGreaterThan(viewport!.width - 20);
  });

  test('switching to English flips to LTR and back to Arabic flips to RTL, mirroring the sidebar both times', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    // --- Switch to English -------------------------------------------------
    await page.getByLabel(TEXT.ar.language, { exact: true }).click();
    const [enBundleResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/i18n/en')),
      page.getByRole('menuitem', { name: 'English' }).click(),
    ]);
    expect(enBundleResponse.status()).toBe(200);

    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // The sidebar's own label is now real English copy, not just the dir attribute.
    await expect(page.getByText(TEXT.en.booksMenu, { exact: true })).toBeVisible();

    const drawerBoxLtr = await page.locator('.MuiDrawer-paper').boundingBox();
    expect(drawerBoxLtr).not.toBeNull();
    // Back on the physical left edge in LTR.
    expect(drawerBoxLtr!.x).toBeLessThan(20);

    // --- Switch back to Arabic ---------------------------------------------
    // No fresh `/i18n/ar` request this time: `ensureLanguageLoaded`
    // (app/i18n.ts) caches every language bundle it has ever fetched in
    // `loadedLanguages`, and Arabic — the app's default (D6/D8) — was
    // already fetched once on initial page load before this test ever
    // switched to English. Waiting for a second `/i18n/ar` response here
    // would hang for the full test timeout; the dir/lang flip (driven
    // synchronously by `i18n.changeLanguage` + `setDirection`) is the real
    // observable effect either way.
    await page.getByLabel(TEXT.en.language, { exact: true }).click();
    await page.getByRole('menuitem', { name: 'العربية' }).click();

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

    const drawerBoxRtl = await page.locator('.MuiDrawer-paper').boundingBox();
    expect(drawerBoxRtl).not.toBeNull();
    expect(drawerBoxRtl!.x + drawerBoxRtl!.width).toBeGreaterThan(viewport!.width - 20);
  });

  test('numbers/dates on a real page stay Latin-digit/Gregorian in the Arabic UI', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl'); // still the Arabic-default UI

    await page.goto('/library/books');
    const row = page.getByRole('row', { name: new RegExp(SEEDED_BOOK_TITLE) });
    await expect(row).toBeVisible();
    const rowText = (await row.textContent()) ?? '';

    // formatDateOnly (apps/web/src/shared/format.ts) renders the book's
    // created-at date in this row — pinned to `numberingSystem: 'latn'` and
    // `calendar: 'gregory'` even though the active UI language is Arabic.
    expect(rowText).toMatch(/\d/); // a real digit is present at all
    expect(hasNoEasternArabicDigits(rowText)).toBe(true);
  });
});
