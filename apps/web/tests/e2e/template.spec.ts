import { expect, test } from '@playwright/test';
import { SURVEY_ADMIN_USER, TEXT } from './support/test-data';

function isApiResponse(response: Response, pathname: string, method = 'GET') {
  try {
    const url = new URL(response.url());
    return url.pathname === pathname && response.request().method() === method;
  } catch {
    return false;
  }
}

/**
 * Template module smoke flow (docs/MODULE_SPEC.md §10) — same admin fixture
 * as survey.spec.ts (SURVEY_ADMIN_USER holds `admin`, which is what every
 * `template.*` permission is granted to by default). Exercises the parts of
 * the manifest a plain CRUD walkthrough doesn't already cover: the module's
 * own `settings` entry (read/edited from the list page) and the public
 * route's real access rule (an `active` item is visible, an `archived` one
 * 404s) — not just "the routes exist."
 */
test.describe('Template module smoke flow', () => {
  test('an admin manages items and their default status; a public link respects the active/archived rule', async ({
    page,
    browser,
  }) => {
    const itemTitle = `Phase9 E2E Template Item ${Date.now()}`;

    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(SURVEY_ADMIN_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(SURVEY_ADMIN_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    // The manifest's `template.root` menu entry has exactly one child
    // (`template.items.list`) — buildModuleMenuEntries.ts collapses a
    // single-child root to one sidebar leaf using the CHILD's own label
    // ("العناصر" / Items), not the root's ("القالب" / Template); the root
    // label is never rendered as its own row in this case.
    const [itemsResponse] = await Promise.all([
      page.waitForResponse((response) => isApiResponse(response, '/api/template/items')),
      // Scoped to the sidebar: the home page now also has a shortcut tile with the same name.
      page.locator('.MuiDrawer-docked').getByRole('link', { name: 'العناصر', exact: true }).click(),
    ]);
    expect(itemsResponse.status()).toBe(200);
    await page.waitForURL(/\/template\/items$/);

    // The module's own `settings` entry — set the default to "active" up
    // front so this run is never affected by whatever a previous run left it as.
    const defaultsSelect = page.getByLabel('الحالة الافتراضية للعناصر الجديدة');
    await expect(defaultsSelect).toBeVisible();
    await defaultsSelect.click();
    await page.getByRole('option', { name: 'نشط' }).click();
    await page.waitForTimeout(300);

    // --- create (no status chosen -> falls back to the "active" default just set) ---
    await page.getByRole('button', { name: 'عنصر جديد' }).click();
    await page.getByLabel('العنوان').fill(itemTitle);
    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => isApiResponse(response, '/api/template/items', 'POST')),
      page.getByRole('button', { name: 'حفظ' }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();

    const row = page.getByRole('row', { name: new RegExp(itemTitle) });
    await expect(row).toBeVisible();

    // --- public link shows the active item to an anonymous visitor ---
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`/template/public/items/${created.id}`);
    await expect(anonPage.getByText(itemTitle)).toBeVisible();
    await anonContext.close();

    // --- archiving it removes it from the public route (404, not an error page) ---
    await row.getByRole('button', { name: 'تعديل' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('الحالة').click();
    await page.getByRole('option', { name: 'مؤرشف' }).click();
    const [updateResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(`/api/template/items/${created.id}`) && response.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'حفظ' }).click(),
    ]);
    expect(updateResponse.status()).toBe(200);

    const anonContext2 = await browser.newContext();
    const anonPage2 = await anonContext2.newPage();
    await anonPage2.goto(`/template/public/items/${created.id}`);
    await expect(anonPage2.getByText('هذا العنصر غير متاح')).toBeVisible();
    await anonContext2.close();

    // --- delete cleans it up (also proves the delete permission/flow works, not just create/update) ---
    await page.reload();
    const rowAfterReload = page.getByRole('row', { name: new RegExp(itemTitle) });
    await rowAfterReload.getByRole('button', { name: 'حذف' }).click();
    const [deleteResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(`/api/template/items/${created.id}`) && response.request().method() === 'DELETE',
      ),
      page.getByRole('button', { name: 'حذف' }).last().click(),
    ]);
    expect(deleteResponse.status()).toBe(204);
    await expect(page.getByRole('row', { name: new RegExp(itemTitle) })).toHaveCount(0);
  });
});
