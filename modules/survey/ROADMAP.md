# Survey module: Microsoft Forms feature inventory, gap analysis and plan

Status: **PROPOSED** (nothing here is built yet; see "Decisions needed" at the end). Written 2026-10-15 for module version 1.2.0.

## 1. How this was compiled (read first)

The goal: list every feature Microsoft Forms offers, per item (form, section, question, answer choice, ...), compare with what this module does today, pick the 10 most used missing features to implement, and document the rest.

- **Sources.** The sandbox this was written in cannot fetch `support.microsoft.com` directly (name resolution fails), so the Microsoft pages were read through search excerpts, plus university help desks and community answers that quote them. Main sources: [Create a form with Microsoft Forms](https://support.microsoft.com/en-us/office/create-a-form-with-microsoft-forms-4ffb64cc-7d5d-402f-b82e-b1d49418fd9d), [Adjust your form or quiz settings](https://support.microsoft.com/en-us/forms/adjust-your-form-or-quiz-settings-in-microsoft-forms), [Branch your form or quiz](https://support.microsoft.com/en-us/topic/branch-your-form-or-quiz-using-microsoft-forms-dd443878-959b-4379-8016-39f885c0ae6b), [Create a quiz](https://support.microsoft.com/en-us/forms/create-a-quiz-with-microsoft-forms), [Check and share your quiz results](https://support.microsoft.com/en-us/forms/check-and-share-your-quiz-results), [Choose who can fill out a form](https://support.microsoft.com/en-us/topic/choose-who-can-fill-out-a-form-or-quiz-c90c641e-6f88-45c5-9cb9-aca2b4083949), [Form, question, response and character limits](https://eus.prod.support.services.microsoft.com/en-gb/office/form-question-response-and-character-limits-in-microsoft-forms-ec15323d-92a4-4c33-bf88-3fdb9e5b5fea), [Tips you must know about Forms settings](https://techcommunity.microsoft.com/blog/microsoftformsblog/tips-you-must-know-about-microsoft-forms-settings/3899997), [Copilot in Forms](https://techcommunity.microsoft.com/blog/microsoftformsblog/introducing-copilot-in-forms-redefining-your-forms-creation/4062885), [Working with Ranking, Likert, Upload file and NPS](https://laramellortraining.co.uk/working-with-ranking-likert-upload-file-and-net-promoter-score-questions-in-microsoft-forms), and the [Illinois State](https://help.illinoisstate.edu/technology/support-topics/communication-and-collaboration-tools/microsoft-365/microsoft-forms/creating-a-form-or-quiz-in-microsoft-forms-add-sections-and-questions) / [Hendrix](https://www.hendrix.edu/HelpDesk_Articles/Computers_and_Drives/Software___Apps/Forms_formatting_and_configuration_options/) guides.
- **Confidence.** Items marked **(?)** came only from third-party guides or conflicting posts and should be re-checked in a live Microsoft Forms account before being copied exactly (examples: rating level range, file-upload size options, number-restriction operators, exact question limit).
- **"papp today"** was checked against the code in `modules/survey` (builder, fill page, DTO, report) on 2026-10-15. Legend: ✅ exists · ◐ partly (see note) · ❌ missing · ➕ papp has it and Microsoft Forms does not.

## 2. Feature inventory by item

### 2.1 The form (survey) itself

| Feature | Microsoft Forms | papp today |
|---|---|---|
| Title | yes | ✅ |
| Description | yes (plain text) | ✅ plain text |
| Header/logo image | yes (image on the form title) | ❌ |
| Theme: preset themes, custom colour (hex), background image | yes | ❌ (platform theme only) |
| Preview as computer / mobile | yes | ❌ |
| Multiple pages (sections) with Next/Back | yes | ✅ (SURVEY-D11) |
| Progress bar (only with 2+ sections) | yes (setting) | ❌ |
| Custom thank-you message (up to 4,000 characters) | yes (setting) | ❌ (only a *closed* message exists) |
| Receipt: respondent can save/print a copy of their answers | yes (setting) | ❌ |
| Start and end date/time | yes | ◐ columns `opens_at`/`closes_at` exist and are carried by duplicate/export, but there is **no editor and no enforcement**; this is a latent bug |
| Accept responses on/off | yes | ✅ publish / close / reopen |
| Close automatically after N responses | not in the Microsoft UI (needs a flow) **(?)** | ❌ (listed because libraries need it for event sign-ups) |
| Who can respond: anyone / people in my organisation / specific people or groups (up to 100) | yes | ◐ anyone or logged-in only; no specific users/roles |
| One response per person | yes (org-only forms) | ✅ (logged-in respondents only) |
| Record name (identify respondents) / anonymous | yes (checkbox) | ◐ implied by "requires login"; no explicit anonymous toggle for logged-in forms |
| Allow respondents to edit after submit | yes | ✅ via edit token (SURVEY-D4) |
| Email notification on each response | yes | ✅ owner + arbitrary addresses ➕ |
| Shuffle question order (not with sections) / lock selected questions | yes | ❌ |
| Smart reminders to non-respondents | yes (direct invitations only) | ❌ (out of scope: no invitation list) |
| Pre-filled link (URL carries answers) | yes (Get pre-filled URL) **(?)** | ❌ |
| Templates / start from a template | yes | ➕ duplicate survey and zip export/import exist (SURVEY-D10) |
| Archive | no | ➕ |
| Language of the form | single language | ❌ (one language per text; platform is Arabic-first, see 4.4) |

### 2.2 A section (page)

| Feature | Microsoft Forms | papp today |
|---|---|---|
| Title | yes | ✅ |
| Description / instructions (can hold text) | yes | ◐ stored and shown to respondents, **no editor in the builder** |
| Image/video in section | yes **(?)** | ❌ |
| Branching: after the section, go to a section or end of form | yes (forward only) | ✅ (SURVEY-D11) ➕ routes by answer, default target |
| Show/hide a section by an earlier answer | no | ➕ |
| Reorder, delete | yes | ✅ |
| Duplicate / move questions between sections | yes | ❌ (move within a section only) |

### 2.3 Items common to every question

| Feature | Microsoft Forms | papp today |
|---|---|---|
| Title (up to 4,000 characters) with rich formatting (bold, italic, underline, size, colour, lists) **(?)** | yes | ◐ plain text, no length limit enforced |
| Subtitle / hint text | yes (More settings → Subtitle) | ◐ `description` stored and shown, **no editor** |
| Image (Bing search, OneDrive, upload) | yes | ❌ |
| Video (YouTube / Stream) | yes | ❌ |
| Math equation in the title | yes (Choice questions) | ❌ |
| Required | yes | ✅ |
| Duplicate / delete / reorder | yes | ◐ delete + reorder only; **no duplicate** |
| Show/hide by an earlier answer | no | ➕ |
| Per-question branching ("go to" on each answer) | yes (Choice) | ◐ available at section level only |
| Restrictions (validation) | yes (Text: number rules; see below) | ❌ |

### 2.4 Question types

| Type | Microsoft Forms | papp today |
|---|---|---|
| **Choice** (single / multiple answers) | yes | ✅ `single_choice`, `multi_choice` |
| Choice as drop-down | yes | ✅ `dropdown` |
| **Text** short | yes | ✅ `short_text` |
| Text long (multi-line) | yes | ✅ `paragraph` |
| **Rating** (stars or numbers, about 2-10 levels, optional labels) **(?)** | yes | ◐ `rating` (max only) + `linear_scale` (min, max only; end labels were sketched in the original design but never built) |
| **Date** (calendar picker) | yes | ✅ |
| Time | no | ➕ |
| **Ranking** (drag to order, about 2-10 items) **(?)** | yes | ❌ |
| **Likert** (several statements on one shared scale, up to 10 statements **(?)**) | yes | ❌ |
| **Net Promoter Score** (0-10, custom end labels) | yes | ❌ (could be done with `linear_scale` 0-10, but not reported as NPS) |
| **File upload** (types: Word, Excel, PowerPoint, PDF, image, audio, video; size options and max 1-10 files **(?)**; stored in the owner's OneDrive) | yes | ❌ (explicitly deferred in SURVEY-D1) |
| Section | yes | ✅ |
| Quick import of questions from Word/PDF | yes (not for ranking) | ❌ |

### 2.5 Answer choices (per Choice question)

| Feature | Microsoft Forms | papp today |
|---|---|---|
| Add, delete, reorder choices | yes | ✅ |
| Image on each choice | yes | ❌ |
| Math in choices | yes | ❌ |
| "Other" choice with a free-text box | yes | ❌ |
| Shuffle choices per respondent | yes | ❌ |
| Multiple answers toggle | yes | ✅ (separate type) |
| **Min / max number of selections** | **no native setting** (a common complaint; usually emulated) | ❌ (requested by the owner) |
| Up to about 499 choices per question; first 60 stored individually in results **(?)** | yes | no limit enforced |
| Required per question | yes | ✅ |
| Branching destination per choice | yes | ◐ section level |
| Feedback per choice (quiz) | yes | ❌ |

### 2.6 Text and number answers

| Feature | Microsoft Forms | papp today |
|---|---|---|
| Restrictions: number only, greater than / less than / between / equal **(?)** | yes | ❌ |
| Character limit | no custom limit; fixed 4,000 per answer, 200,000 per form **(?)** | ❌ (nothing enforced) |
| Email / URL / regex patterns | no (workaround via number rules or Power Automate) | ❌ |
| Placeholder / hint inside the box | no | ❌ |

### 2.7 Quiz mode (Microsoft "New Quiz")

| Feature | Microsoft Forms | papp today |
|---|---|---|
| Points per question | yes | ❌ |
| Mark correct answer(s) | yes (Choice, short text, ranking) | ❌ |
| Several accepted answers for a text question | yes | ❌ |
| Feedback per choice or per question | yes | ❌ |
| Auto-grade (Choice, short text, ranking); manual grade for the rest | yes | ❌ |
| Show results right after submit; or post scores later | yes | ❌ |
| Per-respondent score, time to complete | yes | ❌ |
| Shuffle options/questions in quizzes | yes | ❌ |

### 2.8 Sharing and collecting

| Feature | Microsoft Forms | papp today |
|---|---|---|
| Share by link | yes | ✅ `/survey/:id` |
| QR code | yes | ❌ |
| Embed (iframe) | yes | ❌ |
| Email invitation | yes | ❌ |
| Collaboration link (co-authors edit the form) | yes | ❌ (single owner + role permissions) |
| Share results (read-only link) | yes **(?)** | ❌ |

### 2.9 Responses and results

| Feature | Microsoft Forms | papp today |
|---|---|---|
| Summary with automatic charts | yes | ✅ bar charts per question |
| One response at a time (per person view) | yes | ✅ responses page |
| Excel export | yes | ✅ |
| Delete one / all responses | yes | ◐ delete one; no "delete all" |
| Print summary | yes | ❌ |
| Insights / AI summary (Copilot) | yes (licensed) | ❌ |
| Open results in Excel online / Power Automate flow | yes | ❌ (no webhook) |
| Dynamic pivot table | no | ➕ |

### 2.10 Assistants and integrations (Microsoft only; documented, not planned)

Copilot drafts a form from a sentence, improves questions, drafts invitations, analyses responses; a Surveys agent monitors response goals and sends reminders; Power Automate triggers on new responses; Teams / SharePoint / PowerPoint embedding; Forms Pro / Customer Voice features (rating labels, number restrictions). None of this fits an offline, self-hosted platform without an external service, so it is out of scope.

## 3. The 10 features to implement (ranked)

Ranking = how often the feature is used in real library surveys (reader satisfaction, event feedback, book suggestions, sign-ups) × how much it unblocks, divided by effort. The first five need **no database change** (they live in the question's existing `config` JSONB); the rest need a migration.

| # | Feature | Why now | Effort | Migration |
|---|---|---|---|---|
| 1 | **Selection limits on multiple-choice** (min, max, or exactly N) | Requested by the owner; Microsoft lacks it natively. Prevents "pick your top 3" surveys from collecting 9. | S | no |
| 2 | **"Other" choice with free-text** on single / multiple / dropdown | Almost every choice question in a real survey needs an escape hatch; avoids lossy option lists. | S | no |
| 3 | **Answer validation**: short text (max length; number, email, URL; number min/max), paragraph (max length) | Clean data (phone, card number, age) without manual cleanup. | M | no |
| 4 | **Descriptions in the builder**: editors for section description and question subtitle/hint, plus optional placeholder | The data columns and the fill page already exist; only the editor is missing, so this is the cheapest visible win. | S | no |
| 5 | **Shuffle choices** per question (and **shuffle question order** within a section as a survey setting in phase B) | Removes order bias in satisfaction/rating surveys. | S | no (choices); yes for the survey flag |
| 6 | **Schedule and cap**: editors and server enforcement for open/close date, plus **close after N responses** | Columns already exist but are ignored (a latent bug); event sign-ups need the cap. | M | yes (`response_limit`) |
| 7 | **Thank-you message, progress bar, and receipt** (printable copy of the respondent's answers) | Closes the loop for respondents; progress bar helps long, multi-page surveys. | M | yes (survey settings) |
| 8 | **Images**: survey header image, section image, question image (with alt text); choice images in a second step | The user's example; makes picture-based questions (book covers, events) possible. Needs a storage decision (see section 5). | L | yes |
| 9 | **Likert / matrix question** (several statements on one shared scale) | The most used missing question type in satisfaction surveys; also gives clean per-statement charts. | L | yes (new type) |
| 10 | **Preview and share panel**: preview as respondent (desktop/mobile width), copy link, **QR code**, embed code | Every owner needs to test before publishing and to put a poster QR code in the library. | M | no |

### 3.1 Delivery phases (suggested order)

Each phase is one pull request with its own module version bump (a migration means the middle number, otherwise the last number; the module's compiled `backend/*.js` must be rebuilt and committed each time).

| Phase | Contents | Version | Notes |
|---|---|---|---|
| A | #1 #2 #3 #4 #5 (choices) | 1.2.x (patch bumps) | `config` JSONB only. New keys: `minSelections`, `maxSelections`, `allowOther` (+ `otherLabel`), `validation: {kind, min, max, maxLength}`, `shuffleOptions`, `placeholder`. Validate in `SurveysService.validateQuestionConfig` (builder save) **and** `ResponsesService.validateAnswerShape` (submit), never only the client. "Other" answers store `{value: "__other__", text}`; reports show "Other" as one bar plus a text list. |
| B | #6 #7 + survey-level shuffle | 1.3.0 | Migration 005: `survey_surveys.response_limit INT NULL`, `thank_you_message TEXT NULL`, `settings JSONB NOT NULL DEFAULT '{}'` (progress bar, receipt, shuffle questions; one JSONB column so later flags need no migration). Enforcement in `ResponsesService` (open/close window, cap) with a clear closed/ not-yet-open message. |
| C | #10 | 1.3.x | Frontend only. QR code drawn client-side with a bundled library (no external service). Preview reuses `TakeSurveyPage` in a read-only "preview" mode that never submits. |
| D | #8 | 1.4.0 | Migration 006 + upload endpoint; blocked on the storage decision below. |
| E | #9 | 1.5.0 | Migration 007. See the enum note below. |

### 3.2 Per-feature design notes (so each phase can start without rediscovery)

1. **Selection limits.** Config `{minSelections?, maxSelections?}` on `multi_choice` (and the "exactly N" case as min = max). Builder: two number fields shown only for multi choice, validated `0 <= min <= max <= number of options`. Fill page: disable unchecked boxes once the max is reached and show "choose between X and Y". Server re-validates the count. Interacts with `required` (min 1 when required). Reports unchanged.
2. **"Other".** Config `{allowOther: true, otherLabel?}` on the three choice types. Answer shape gains an optional free-text part; `validateAnswerShape` rejects text when the "other" value was not chosen, and caps its length. The pivot and Excel export get an "Other (text)" column.
3. **Validation.** Config `validation` by kind: `text` (maxLength), `number` (integer?, min, max), `email`, `url`. Messages are translated; both `ar` and `en` keys required (the locale-completeness test enforces it). Regex is intentionally **not** offered at first (ReDoS risk; see backlog).
4. **Descriptions.** Add two text fields to the builder (section description, question hint) and a placeholder field; no schema change. Add a short plain-text length limit (e.g. 2,000 characters). Rich formatting is backlog.
5. **Shuffle.** Per-question `shuffleOptions`: the fill page shuffles once per page load (stable for that visit); stored answers use option values so results are unaffected. "Other" and "None of the above" stay last. Question shuffle is a survey flag in phase B and is disabled when sections use routing (same restriction Microsoft has with sections).
6. **Schedule and cap.** Add date-time pickers (using the shared Gregorian/Latin-digit formatters, D6/D7) for opens/closes; `ResponsesService` and the public/fill GET endpoints return a distinct "not open yet" / "closed" state; the cap counts submitted responses inside the same transaction as the insert to avoid overshoot. Show the schedule and remaining count in the survey list.
7. **Thank-you, progress, receipt.** Thank-you text per survey (max 4,000 characters, plain text, rendered safely). Progress bar from the visited-path position (works with routing by using the resolved path length). Receipt = a print-friendly view of the respondent's own answers (browser print), no server-side PDF.
8. **Images.** Store only a reference (`imageId`) plus `alt` on survey, section and question; choice images follow in a second step. Serve through a safe endpoint like the theme-asset endpoint (D98: declared file only, `nosniff`, sandboxing CSP, SVG allowed only with the sandbox). Limit type (png/jpg/webp), size (for example 2 MB) and count; audit uploads and deletions; remove images from storage when the survey is deleted. Respondents see an `alt`-labelled image; the report ignores images.
9. **Likert.** New type `likert`: config `{statements: [{id,label}], scale: {points, labels[]}}`; the answer is an object keyed by statement id. Required means every statement answered. Report: one stacked/grouped bar per statement and an average. The pivot flattens it to one column per statement. Down-migration and duplicate/export/import must carry the new config.
10. **Preview and share.** Builder gets a "Preview" button (desktop / phone width) and a "Share" dialog (copy link, QR code as downloadable PNG/SVG, iframe snippet, link to the respondent URL). Nothing is stored.

### 3.3 Cross-cutting rules for every item (from `papp-add-feature`)

- Every new setting has `ar` and `en` strings; RTL checked; no raw `toLocaleString`.
- Server re-validation of anything the client enforces.
- New permission codes only if a new capability appears (images may need `survey.surveys.update` only; none planned). No hardcoded role names.
- Audit: builder saves are already audited through `PUT /structure`; upload/delete of images adds its own audit rows (no file bytes).
- Export / import / duplicate must round-trip every new config key (they remap ids, see SURVEY-D10/D11).
- Tests: unit (`validateStructure`, `validateAnswerShape`, `logic-engine`), plus an e2e smoke of one new feature per phase. Tests live inside the module (`modules/survey/test/...`).
- Update `DOCUMENTATION.md` and `DECISIONS.md` in the same pull request as each phase.

## 4. Backlog: everything else, documented

### 4.1 Question types (not in the top 10)

| Item | Notes |
|---|---|
| **Ranking** | Drag-and-drop order of 2-10 items; needs a keyboard-accessible reorder control (not drag only). Report: average rank per item. Likely the next type after Likert. |
| **Net Promoter Score** | Fixed 0-10 with custom end labels; report adds promoters/passives/detractors and the score. Cheap once `linear_scale` reporting is generalised. |
| **File upload** | Needs the same storage decision as images plus virus scanning, per-file size and count limits, and an access rule for who can download. Deferred since SURVEY-D1. |
| **Matrix of dropdowns / multiple choice grid** | Generalises Likert (different answer kind per row). |
| **Quick import from Word/PDF/Excel** | Convert a pasted list into questions; better first step: "bulk add choices" by pasting lines. |
| **Number/Yes-No/Email as dedicated types** | Covered by validation (#3) and a 2-choice question. |

### 4.2 Quiz mode (a project of its own)

Points per question; correct answer(s) for choice/short text/ranking; several accepted text answers; feedback per choice/question; auto-grade vs manual grade; show results after submit or post scores later; per-respondent score and time taken; shuffle in quizzes; quiz-specific report (per question % correct). Needs a `quiz` survey flag, answer keys stored apart from the public fill payload (never sent to the browser), and a grading screen. Probably 2-3 phases. Library use cases: reading-club comprehension quizzes, orientation tests.

### 4.3 Form-level and respondent experience

- Theme: colour, background image, per-survey (conflicts with the platform theme packs; decide whether surveys may override).
- Rich text in titles and descriptions (bold/italic/lists) with safe sanitising.
- Math equations in titles.
- Video in a question (YouTube embed would need an external-content decision).
- Lock selected questions while shuffling; shuffle sections.
- Per-question branching (not just per section).
- Specific people/roles allowed to respond; explicit anonymous toggle for logged-in surveys; email invitations and reminders; pre-filled links.
- Multiple-language surveys (see 4.4).
- Respondent "save and continue later" (conflicts with the module's deliberate rule that nothing partial is stored, SURVEY-D1/DOC; would need an explicit owner decision).
- CAPTCHA / bot protection on anonymous links (rate limiting exists via the public throttler).

### 4.4 Platform-specific items Microsoft does not cover

- **Bilingual surveys.** This platform is Arabic-first with English. Today a survey has one text per field. A real fix is per-language fields (title/description/options in `ar` and `en`) with the respondent's language choosing which to show. Large (touches every table); recommended to be planned separately from this roadmap.
- **Reader/member linking.** Tie a response to a library reader (card number) when the respondent is logged in.

### 4.5 Results and administration

- Delete all responses (with confirmation and audit); print/PDF of the summary; more chart types (pie, stacked, trend over time); filters on the report (date range, by answer); response time analytics; respondent-facing "see results" link; shareable read-only results link; scheduled/emailed summary.
- Webhook or API on new response (the offline replacement for Power Automate); CSV export alongside Excel.
- Collaboration: co-owners who can edit one survey (today access is by role permission only).
- Insights / AI summary and "generate a survey from a sentence": only if an external model is approved (privacy decision), otherwise out of scope.
- Templates gallery (starter surveys such as "Event feedback", "Reader satisfaction") shipped as importable packages using the existing zip format (SURVEY-D10): cheap and useful, a good candidate right after phase A.

## 5. Decisions needed from the owner before building

1. **Image storage (blocks phase D and file upload).** The platform has no general file store today. Options: (a) files on a mounted disk volume served by the API; (b) database `bytea` (simple backup/restore, heavier DB); (c) an external object store (S3-compatible). Recommendation: (a) with a size/type allow-list, because it matches the offline, single-`docker compose` setup and the theme-asset pattern (D98). Needs a backup note, since volume contents are not in the database dump.
2. **Where survey settings go.** Recommendation: one `settings JSONB` column (phase B) so future flags need no migration, plus real columns only for things queried in SQL (`response_limit`).
3. **New question types and the Postgres enum.** `survey_question_type` is a native enum; `ALTER TYPE ... ADD VALUE` is awkward inside the migration runner's transaction (the reason SURVEY-D11 avoided a new enum value). Options: convert the column to `TEXT` with a CHECK (one-time migration, easier later), or ship each new type in its own non-transactional migration. Recommendation: convert once in the Likert migration.
4. **Is the top-10 list right?** In particular: swap #7 (thank-you/receipt) or #10 (preview/QR) for **quiz mode** or **ranking** if those matter more for the library's use cases.
5. **Bilingual survey content (4.4)**: in scope for this effort, or a separate project?
