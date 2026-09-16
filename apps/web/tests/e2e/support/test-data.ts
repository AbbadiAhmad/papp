/**
 * Tier 2 (Playwright) fixtures — docs/TESTING_STRATEGY.md §0/D37.
 *
 * These accounts are dedicated Phase 9 e2e fixtures seeded directly into
 * the local Postgres this sandbox uses (same DB every prior phase's
 * Developer/Tester agents used — see this Tester agent's final report for
 * the exact SQL). The `pw9e2e.` email prefix is deliberate: other agents
 * working concurrently on apps/api/test/** (integration/e2e) seed their own
 * fixtures into the same database, and this prefix keeps this suite's rows
 * unambiguous and non-colliding.
 *
 * Real text strings below (both languages) were read directly off the
 * running backend's `GET /i18n/:lang` bundle
 * (apps/api/src/core/i18n/locales/{en,ar}.json) and the frontend-only
 * `apps/web/src/locales/core/{en,ar}.json` — never guessed. If a developer
 * agent changes that copy, these specs will fail loudly (the correct
 * outcome for a real e2e assertion) rather than silently drift.
 */

/**
 * The real api origin these specs talk to directly (see
 * playwright.config.ts — same PW_API_PORT default). Response matchers use
 * this rather than a bare path suffix: the SPA's OWN page-navigation
 * response (e.g. `http://localhost:5173/modules`, served by history-fallback
 * for a direct `page.goto('/modules')`) also ends with `/modules`, so a
 * suffix-only match races against — and can resolve to — that unrelated
 * 200 instead of the real backend 403. Learned the hard way while first
 * running these specs (see this Tester agent's final report).
 */
export const API_ORIGIN = `http://localhost:${process.env.PW_API_PORT ?? '3100'}`;

export const READER_USER = {
  email: 'pw9e2e.reader@papp.local',
  name: 'Phase9 E2E Reader',
  password: 'E2eReader2026!',
};

export const FORCE_PASSWORD_CHANGE_USER = {
  email: 'pw9e2e.pwchange@papp.local',
  name: 'Phase9 E2E ForcePwChange',
  // Seeded with must_change_password = true.
  tempPassword: 'E2eTemp2026!',
  newPassword: 'E2eChanged2026!',
};

export const INVALID_PASSWORD = 'not-the-real-password-1';

/** Title of the library_catalog_books row seeded for the Phase 9 smoke flow. */
export const SEEDED_BOOK_TITLE = 'Phase9 E2E Smoke Test Book';

/**
 * Survey module fixture (holds the `admin` role — none of `library_assistant`
 * / `finance` / `reader` get any `survey.*` permission by default, so the
 * builder/publish/responses/report flow genuinely needs an admin-role
 * account, unlike the plain `reader` fixture above).
 */
export const SURVEY_ADMIN_USER = {
  email: 'pw9e2e.surveyadmin@papp.local',
  name: 'Phase9 E2E Survey Admin',
  password: 'E2eSurveyAdmin2026!',
};

export const TEXT = {
  en: {
    login: 'Log in',
    logout: 'Log out',
    email: 'Email',
    password: 'Password',
    invalidCredentials: 'Invalid email or password',
    mustChangePassword: 'You must change your password before continuing',
    newPassword: 'New password',
    changePassword: 'Change password',
    language: 'Language',
    forbiddenTitle: "You don't have access",
    booksMenu: 'Books',
    save: 'Save',
    confirmPassword: 'Confirm password',
    surveysMenu: 'Surveys',
    newSurvey: 'New survey',
    surveyTitleField: 'Title',
    sectionTitleField: 'Section title',
    questionTitleField: 'Question title',
    questionTypeField: 'Question type',
    optionValueField: 'Option value',
    optionLabelField: 'Option label',
    addQuestion: 'Add question',
    addOption: 'Add option',
    addRule: 'Add rule',
    singleChoiceType: 'Single choice',
    publish: 'Publish',
    submit: 'Submit',
    thankYou: 'Thank you — your response has been recorded.',
  },
  ar: {
    login: 'تسجيل الدخول',
    logout: 'تسجيل الخروج',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    mustChangePassword: 'يجب تغيير كلمة المرور قبل المتابعة',
    newPassword: 'كلمة المرور الجديدة',
    changePassword: 'تغيير كلمة المرور',
    language: 'اللغة',
    forbiddenTitle: 'لا تملك صلاحية الوصول',
    booksMenu: 'الكتب',
    save: 'حفظ',
    confirmPassword: 'تأكيد كلمة المرور',
    surveysMenu: 'الاستبيانات',
    newSurvey: 'استبيان جديد',
    surveyTitleField: 'العنوان',
    sectionTitleField: 'عنوان القسم',
    questionTitleField: 'نص السؤال',
    questionTypeField: 'نوع السؤال',
    optionValueField: 'قيمة الخيار',
    optionLabelField: 'نص الخيار',
    addQuestion: 'إضافة سؤال',
    addOption: 'إضافة خيار',
    addRule: 'إضافة قاعدة',
    singleChoiceType: 'اختيار واحد',
    publish: 'نشر',
    submit: 'إرسال',
    thankYou: 'شكراً لك — تم تسجيل ردك.',
  },
};
