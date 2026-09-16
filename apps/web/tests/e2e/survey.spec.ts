import { expect, test } from '@playwright/test';
import { SURVEY_ADMIN_USER, TEXT } from './support/test-data';

/**
 * Survey module smoke flow (mirrors library-catalog.spec.ts's shape, but
 * this module has no static seeded fixture to read — the builder itself
 * IS the feature under test): an admin builds a real survey with a
 * conditional show/hide rule, publishes it, an ANONYMOUS second browser
 * context fills it out (the branch question only appears after picking the
 * matching option — this is `logic-engine.ts`'s live client-side evaluator,
 * not a mock), and the admin then sees the real response and its report.
 *
 * Every survey created here gets a random suffix so repeated local runs
 * never collide on title-based lookups (`SURVEY_ADMIN_USER` has no
 * per-spec data reset the way FORCE_PASSWORD_CHANGE_USER does).
 */
test.describe('Survey smoke flow', () => {
  test('admin builds a branching survey; an anonymous respondent fills it; admin sees the response and report', async ({ page, browser }) => {
    const surveyTitle = `Phase9 E2E Survey ${Date.now()}`;

    await page.goto('/login');
    await page.getByLabel(TEXT.ar.email).fill(SURVEY_ADMIN_USER.email);
    await page.getByLabel(TEXT.ar.password).fill(SURVEY_ADMIN_USER.password);
    await page.getByRole('button', { name: TEXT.ar.login }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    const [surveysResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/survey/surveys') && res.request().method() === 'GET'),
      page.getByRole('link', { name: TEXT.ar.surveysMenu, exact: true }).click(),
    ]);
    expect(surveysResponse.status()).toBe(200);
    await page.waitForURL(/\/survey\/surveys$/);

    // --- create ---
    await page.getByRole('button', { name: TEXT.ar.newSurvey }).click();
    await page.getByLabel(TEXT.ar.surveyTitleField).first().fill(surveyTitle);
    const [createResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/survey/surveys') && res.request().method() === 'POST'),
      page.getByRole('button', { name: TEXT.ar.save }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    await page.waitForURL(/\/survey\/surveys\/[^/]+\/edit$/);
    const surveyId = page.url().match(/surveys\/([^/]+)\/edit/)?.[1];
    expect(surveyId).toBeTruthy();

    // --- build: one single_choice question (2 options) that reveals a
    // second question only when "Red" is picked ---
    await page.getByLabel(TEXT.ar.sectionTitleField).fill('Section 1');
    await page.getByRole('button', { name: TEXT.ar.addQuestion }).click();
    await page.getByLabel(TEXT.ar.questionTitleField).first().fill('Pick a color');
    await page.getByLabel(TEXT.ar.questionTypeField).first().click();
    await page.getByRole('option', { name: TEXT.ar.singleChoiceType }).click();
    await page.getByRole('button', { name: TEXT.ar.addOption }).click();
    await page.getByLabel(TEXT.ar.optionValueField).first().fill('red');
    await page.getByLabel(TEXT.ar.optionLabelField).first().fill('Red');
    await page.getByRole('button', { name: TEXT.ar.addOption }).click();
    await page.getByLabel(TEXT.ar.optionValueField).nth(1).fill('blue');
    await page.getByLabel(TEXT.ar.optionLabelField).nth(1).fill('Blue');

    await page.getByRole('button', { name: TEXT.ar.addQuestion }).click();
    await page.getByLabel(TEXT.ar.questionTitleField).nth(1).fill('Why red?');

    await page.getByRole('button', { name: TEXT.ar.addRule }).click();

    const [structureResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/structure') && res.request().method() === 'PUT'),
      page.getByRole('button', { name: TEXT.ar.save }).click(),
    ]);
    expect(structureResponse.status()).toBe(200);

    // --- publish (from the list page) ---
    await page.goto('/survey/surveys');
    const row = page.getByRole('row', { name: new RegExp(surveyTitle) });
    await expect(row).toBeVisible();
    await row.getByLabel(TEXT.ar.publish).click();
    await expect(row.getByText('منشور')).toBeVisible();

    // --- anonymous respondent, separate browser context (no cookies shared) ---
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`/survey/${surveyId}`);
    await expect(anonPage.getByText('Pick a color')).toBeVisible();
    await expect(anonPage.getByText('Why red?')).toHaveCount(0);

    await anonPage.getByText('Red', { exact: true }).click();
    await expect(anonPage.getByText('Why red?')).toBeVisible();
    await anonPage.locator('textarea, input[type=text]').last().fill('Because it is bold.');

    const [submitResponse] = await Promise.all([
      anonPage.waitForResponse((res) => res.url().includes('/api/survey/public/') && res.request().method() === 'POST'),
      anonPage.getByRole('button', { name: TEXT.ar.submit }).click(),
    ]);
    expect(submitResponse.status()).toBe(201);
    await expect(anonPage.getByText(TEXT.ar.thankYou)).toBeVisible();
    await anonContext.close();

    // --- admin: the response and its report are both real, not stubs ---
    await page.goto(`/survey/surveys/${surveyId}/responses`);
    await expect(page.getByText('مجهول')).toBeVisible(); // "Anonymous" respondent

    await page.goto(`/survey/surveys/${surveyId}/report`);
    await expect(page.getByText('إجمالي الردود: 1')).toBeVisible();
    await expect(page.getByText('Because it is bold.')).toBeVisible();
  });
});
