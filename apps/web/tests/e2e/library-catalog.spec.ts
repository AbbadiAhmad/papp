import { expect, test } from '@playwright/test';
import { READER_USER, SEEDED_BOOK_TITLE, TEXT } from './support/test-data';

/**
 * Library Catalog smoke flow (docs/TESTING_STRATEGY.md §1's Playwright
 * bullet, item 5): log in as a role holding `library_catalog.books.view`
 * (the seeded `reader` role — confirmed via role_permissions in this
 * Tester agent's final report), see real seeded data on the books list,
 * open a book's detail page.
 *
 * `SEEDED_BOOK_TITLE` is a `library_catalog_books` row this Tester agent
 * inserted directly via SQL (see final report) specifically for this spec,
 * distinct from the other fixture rows already present in the shared dev
 * database so the assertion is unambiguous either way.
 */
test.describe('Library Catalog smoke flow', () => {
  test('a reader can view the books list and open a book detail page', async ({ page }) => {
    // The books list defaults to the card view; this smoke flow opens a book from a table row.
    await page.addInitScript(() => window.localStorage.setItem('papp:books-view', 'table'));
    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(READER_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(READER_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    // A reader may see only ONE page of library_catalog (books.view), so the shared nav rule
    // (buildNavEntries, D113) shows "المكتبة" as a direct sidebar link to it, not a one-item
    // group. Scoped to the sidebar: the home page also has a shortcut tile with the same name.
    const [booksResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/library/books') && res.request().method() === 'GET'),
      page.locator('.MuiDrawer-docked').getByRole('link', { name: TEXT.ar.libraryMenuGroup, exact: true }).click(),
    ]);
    expect(booksResponse.status()).toBe(200);
    await page.waitForURL(/\/library\/books$/);

    const bookRow = page.getByRole('row', { name: new RegExp(SEEDED_BOOK_TITLE) });
    await expect(bookRow).toBeVisible();

    const [detailResponse] = await Promise.all([
      page.waitForResponse((res) => /\/api\/library\/books\/[^/]+$/.test(res.url()) && res.request().method() === 'GET'),
      bookRow.getByRole('link', { name: SEEDED_BOOK_TITLE }).click(),
    ]);
    expect(detailResponse.status()).toBe(200);
    await page.waitForURL(/\/library\/books\/[^/]+$/);

    await expect(page.getByRole('heading', { name: SEEDED_BOOK_TITLE })).toBeVisible();
  });
});
