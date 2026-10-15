# Survey module: feature inventory (Microsoft Forms, Google Forms, SurveyMonkey), gap analysis and plan

Status: **PLAN APPROVED, decisions answered (section 5); nothing is built yet.** Written 2026-10-15 for module version 1.2.0; cross-checked against Google Forms and SurveyMonkey the same day (section 2.11).

## 1. How this was compiled (read first)

The goal: list every feature Microsoft Forms offers, per item (form, section, question, answer choice, ...), compare with what this module does today, pick the 10 most used missing features to implement, and document the rest.

- **Sources.** The sandbox this was written in cannot fetch `support.microsoft.com` directly (name resolution fails), so the Microsoft pages were read through search excerpts, plus university help desks and community answers that quote them. Main sources: [Create a form with Microsoft Forms](https://support.microsoft.com/en-us/office/create-a-form-with-microsoft-forms-4ffb64cc-7d5d-402f-b82e-b1d49418fd9d), [Adjust your form or quiz settings](https://support.microsoft.com/en-us/forms/adjust-your-form-or-quiz-settings-in-microsoft-forms), [Branch your form or quiz](https://support.microsoft.com/en-us/topic/branch-your-form-or-quiz-using-microsoft-forms-dd443878-959b-4379-8016-39f885c0ae6b), [Create a quiz](https://support.microsoft.com/en-us/forms/create-a-quiz-with-microsoft-forms), [Check and share your quiz results](https://support.microsoft.com/en-us/forms/check-and-share-your-quiz-results), [Choose who can fill out a form](https://support.microsoft.com/en-us/topic/choose-who-can-fill-out-a-form-or-quiz-c90c641e-6f88-45c5-9cb9-aca2b4083949), [Form, question, response and character limits](https://eus.prod.support.services.microsoft.com/en-gb/office/form-question-response-and-character-limits-in-microsoft-forms-ec15323d-92a4-4c33-bf88-3fdb9e5b5fea), [Tips you must know about Forms settings](https://techcommunity.microsoft.com/blog/microsoftformsblog/tips-you-must-know-about-microsoft-forms-settings/3899997), [Copilot in Forms](https://techcommunity.microsoft.com/blog/microsoftformsblog/introducing-copilot-in-forms-redefining-your-forms-creation/4062885), [Working with Ranking, Likert, Upload file and NPS](https://laramellortraining.co.uk/working-with-ranking-likert-upload-file-and-net-promoter-score-questions-in-microsoft-forms), and the [Illinois State](https://help.illinoisstate.edu/technology/support-topics/communication-and-collaboration-tools/microsoft-365/microsoft-forms/creating-a-form-or-quiz-in-microsoft-forms-add-sections-and-questions) / [Hendrix](https://www.hendrix.edu/HelpDesk_Articles/Computers_and_Drives/Software___Apps/Forms_formatting_and_configuration_options/) guides.
- **Second and third reference.** Because the Microsoft pages could only be read second-hand, the same exercise was repeated for Google Forms and SurveyMonkey (section 2.11). A feature offered by two or three tools is a safer bet than one offered by a single tool, and it settles most of the **(?)** doubts about the top 10.
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

### 2.11 Cross-check: Google Forms and SurveyMonkey

Sources (again read through search excerpts; the vendor help sites could not be fetched from the sandbox): Google Forms: [cheat sheet](https://extendedforms.io/blog/google-forms-cheat-sheet), [question types](https://formfacade.com/website/resource/question-types-in-google-forms.html), [response validation](https://www.howtogeek.com/773613/how-to-validate-answers-to-questions-in-google-forms/), [settings](https://formswrite.com/blog/google-forms-settings-guide), [shuffling and images](https://www.controlaltachieve.com/2017/01/forms-sequencing.html). SurveyMonkey: [Checkboxes question](https://help.surveymonkey.com/en/surveymonkey/create/checkbox/), [Logic features](https://help.surveymonkey.com/en/surveymonkey/create/logic-options/), [Question skip logic](https://help.surveymonkey.com/en/surveymonkey/create/question-skip-logic/), [Piping](https://help.surveymonkey.com/en/surveymonkey/create/question-answer-piping/), [Character limits](https://help.surveymonkey.com/en/surveymonkey/create/design-character-limits/), [Quizzes](https://help.surveymonkey.com/en/surveymonkey/create/quizzes/), [Single textbox](https://help.surveymonkey.com/en/surveymonkey/create/single-textbox/), [Crosstabs and filters](https://www.surveymonkey.com/product/features/crosstabs/).

| Feature | Microsoft | Google Forms | SurveyMonkey | In top 10? |
|---|---|---|---|---|
| Min / max / exactly N selections on checkboxes | no | **yes** (response validation: at least, at most, exactly) | **yes** (at least, at most, a range, exactly, all; with a "None of the above" choice only at least/at most) | #1 (confirmed by two tools) |
| "Other" choice with text | yes | yes | yes ("Other" answer / comment field) | #2 |
| Text/number validation with a custom error message | partly (number rules) | yes: number (is number, between, equal), text (contains, email/URL **(?)**), max length, regular expression; paragraph: length and regex | yes: length, whole/decimal number, date format, email; custom error message (250 characters) | #3 |
| Shuffle choices / questions | yes | yes (choices; question order in settings) | yes (choices, questions, pages, blocks) | #5 |
| Description with basic formatting and links | rich text | bold/italic/underline, links | rich text | #4 (plain text first; formatting in backlog) |
| Images in questions | yes | yes | yes; also an Image Choice question | #8 |
| Close date / maximum number of responses | start/end date | close date; **no response cap** (needs an add-on or manual close) | end date and maximum response count | #6 |
| Confirmation (thank-you) message, progress bar | yes | yes (Presentation settings) | custom end page, progress bar **(?)** | #7 |
| Emailed copy of the answers to the respondent | receipt on the thank-you page | "send responders a copy" (needs email collection) | **(?)** | #7 (printable receipt first; email copy is backlog) |
| Limit to one response per person | yes (org only) | yes (needs a Google account) | **(?)** | exists (login only) |
| Allow editing after submit | yes | yes (edit link) | **(?)** | exists |
| Grid / matrix questions | Likert | multiple-choice grid and checkbox grid (optional "one answer per column", "require each row") | Matrix / Rating Scale / Matrix of dropdowns (advice: at most 5 rows and columns) | #9 |
| Ranking | yes | no native (workarounds) | yes (advice: use sparingly) | backlog |
| NPS | yes | no native | yes | backlog |
| File upload | yes | yes (sign-in required, counts against Drive) | yes (paid) **(?)** | backlog |
| Quiz mode | yes | yes (points + answer key, auto-grade) | yes (scoring on choice, checkbox, image choice, dropdown) | backlog (4.2) |
| Skip / branching | forward only | by section ("go to section") | page and question skip logic, disqualification page, advanced conditions | exists (section routing) |
| Show/hide by earlier answer | no | no (section routing only) | display logic | exists ➕ |
| Piping (insert an earlier answer into later text) and carry-forward choices | no | no | yes (paid) | backlog |
| Block/page randomisation, response quotas | no | no | yes (higher plans) | backlog |
| Filters and crosstabs in results, share results page | summary only | summary charts, Sheets link | filters, crosstabs with significance testing, shared data pages | pivot exists ➕; filters in backlog |
| Export formats | Excel | Sheets / CSV | PDF, PPT, XLS, CSV, SPSS (paid) | Excel exists; CSV in backlog |

What this changed in the plan:

- **#1 is the strongest candidate** (both Google Forms and SurveyMonkey have it; Microsoft does not). Design it with SurveyMonkey's full set: at least, at most, a range, exactly N, plus a rule for an **exclusive "None of the above"** choice (choosing it clears other boxes and the min/max then does not apply to it).
- **#3 needs a custom error message per rule** (both other tools have it) and should offer Google's "between" and "is number" conditions. A regular expression is offered by Google only; it stays in the backlog because of the ReDoS risk.
- **#6 is better justified**: SurveyMonkey has a response cap and Google users miss it.
- **#9 (Likert) design** should allow the Google options "require a response in each row" and a row-count advice (about 5 to 8 rows) in the builder.
- **New backlog items** found only in the other tools: piping and carry-forward (reuse an earlier answer in later text or choices), a disqualification ("screen-out") end page, page/block randomisation, response quotas per answer, report filters and crosstab significance, CSV export, and an emailed copy of answers.

## 3. The 10 features to implement (ranked by user experience)

Owner direction (2026-10-15): focus on the everyday experience of the people filling in and building surveys, not on impressive features that are rarely used. Ranking therefore goes: (a) what a respondent meets (clear errors, hints, closing messages, progress), (b) what a survey owner does all day (build, test, share), then (c) richer content. Features judged rarely used (Likert grid, shuffle, printable receipt, ranking, NPS, quiz) moved to the top of the backlog ("next up", section 4.0).

| # | Feature | Who benefits | Effort | Migration |
|---|---|---|---|---|
| 1 | **Answer validation with clear inline messages**: short text (max length; number, email, URL; number min/max/between), paragraph (max length); custom message per rule | Respondent: errors appear next to the field, in their language, before submit. Owner: clean data (phone, card number, age). All three reference tools have it. | M | no |
| 2 | **Selection limits on checkboxes** (at least, at most, range, exactly N; exclusive "None of the above") with a live hint ("choose 2 to 3", counter, boxes disable at the maximum) | Respondent: cannot make a mistake. Requested by the owner; Google Forms and SurveyMonkey have it. | S | no |
| 3 | **Hints and instructions in the builder**: editors for section description, question hint, and an input placeholder | Respondent: knows what is expected. The data and the respondent page already exist; only the editor is missing. | S | no |
| 4 | **Preview**: see the survey as a respondent (desktop and phone width) without submitting | Owner: test before publishing. | M | no |
| 5 | **Builder usability pack**: duplicate a question or section, move a question to another section, and an unsaved-changes warning when leaving the builder | Owner: building a 30-question survey today means retyping and risks losing work. (No unsaved-changes guard exists today.) | M | no |
| 6 | **Schedule and response cap with clear messages**: editors and server enforcement for open/close date, plus close after N responses ("not open yet", "closed", "full") | Respondent: understands why they cannot answer. Owner: event sign-ups. Fixes a latent bug (dates exist but are ignored). | M | yes (`response_limit`) |
| 7 | **"Other" choice with free text** on single / multiple / dropdown | Respondent: never forced into a wrong option. Common in real surveys. | S | no |
| 8 | **Thank-you message and progress bar** | Respondent: confirmation and a sense of how long is left. | M | yes (survey settings) |
| 9 | **Share panel**: copy link, QR code (for posters in the library), embed snippet | Owner: getting the survey to readers. | S | no |
| 10 | **Images**: survey header image, section image, question image with alt text (choice images in a second step) | Both: picture-based questions (book covers, events). Heaviest item (new file storage), so last. | L | yes |

Moved to the backlog top (4.0): Likert/matrix grid, shuffle (choices and questions), printable receipt, ranking, NPS.

### 3.1 Delivery phases (suggested order)

Each phase is one pull request with its own module version bump (a migration means the middle number, otherwise the last number; the module's compiled `backend/*.js` must be rebuilt and committed each time).

| Phase | Contents | Version | Notes |
|---|---|---|---|
| A: respondent essentials | #1 #2 #3 #7 | 1.2.x (patch bumps) | `config` JSONB only, no migration. New keys: `validation: {kind, min, max, maxLength, message}`, `minSelections`, `maxSelections`, `exclusiveOptionValue`, `allowOther` (+ `otherLabel`), `placeholder`. Validate in `SurveysService.validateQuestionConfig` (builder save) **and** `ResponsesService.validateAnswerShape` (submit), never only the client. "Other" answers store `{value: "__other__", text}`; reports show "Other" as one bar plus a text list. |
| B: owner tools | #4 #5 #9 | 1.2.x | Frontend only. Preview reuses `TakeSurveyPage` in a read-only mode that never submits. QR code is drawn client-side with a bundled library (no external service). Duplicate/move/unsaved-changes work on the builder's in-memory structure. |
| C: lifecycle | #6 #8 | 1.3.0 | Migration 005: `survey_surveys.response_limit INT NULL` and `settings JSONB NOT NULL DEFAULT '{}'` (decision 2). `settings` carries `thankYouMessage`, `showProgressBar` and later flags. Enforcement in `ResponsesService` and in the public/fill GET endpoints (distinct "not open yet" / "closed" / "full" states). |
| D: images | #10 | 1.4.0 | Migration 006 + upload endpoint + files on a mounted volume (decision 1). |

### 3.2 Per-feature design notes (so each phase can start without rediscovery)

1. **Validation.** Config `validation` by kind: `text` (maxLength), `number` (integer?, min, max, between), `email`, `url`. Each rule has an optional custom error message per language, falling back to a translated default (both `ar` and `en` keys required; the locale-completeness test enforces it). The fill page validates on blur and on Next/Submit and shows the message under the field; the server re-validates. Regular expressions are **not** offered at first (ReDoS risk; backlog).
2. **Selection limits.** Config `{minSelections?, maxSelections?, exclusiveOptionValue?}` on `multi_choice` ("exactly N" is min = max; `exclusiveOptionValue` marks a "None of the above" choice that cannot be combined with others and is exempt from the count). Builder: number fields shown only for multiple choice, validated `0 <= min <= max <= number of options`. Fill page: counter hint, unchecked boxes disable at the maximum. Interacts with `required` (min 1 when required). Server re-validates the count.
3. **Hints.** Add three fields to the builder (section description, question hint, placeholder); no schema change. Plain text, length-limited (for example 2,000 characters). Rich formatting is backlog.
4. **Preview.** A "Preview" button opens the respondent page in a read-only mode (no network writes, banner "Preview"), with a width toggle (desktop / phone). Uses the unsaved structure so the owner sees changes before saving.
5. **Builder usability.** Duplicate question (fresh UUIDs, options copied, logic rules not copied), duplicate section, "move to section" selector on a question (rules that point at it are kept; routes are re-validated), and a browser `beforeunload` plus router-leave warning when there are unsaved changes.
6. **Schedule and cap.** Date-time pickers (shared Gregorian/Latin-digit formatters, D6/D7) for opens/closes. `ResponsesService` and the GET endpoints return distinct states with translated messages. The cap counts submitted responses inside the same transaction as the insert to avoid overshoot. Show schedule and remaining count in the survey list.
7. **"Other".** Config `{allowOther: true, otherLabel?}` on the three choice types. Answer shape gains an optional free-text part; `validateAnswerShape` rejects text when "other" was not chosen and caps its length. The pivot and Excel export get an "Other (text)" column.
8. **Thank-you and progress.** Thank-you text per survey (max 4,000 characters, plain text, rendered safely) shown after submit instead of the generic text. Progress bar from the position in the resolved path (works with routing); shown only with 2+ sections.
9. **Share panel.** Copy link, QR code as downloadable PNG/SVG, iframe snippet (needs the public page to allow framing for that route only; check the platform's frame headers before promising it), link to the respondent URL. Nothing is stored.
10. **Images.** Store only a reference (`imageId`) plus `alt` on survey, section and question; choice images follow. Files on a mounted disk volume, served through a safe endpoint like the theme-asset endpoint (D98: declared file only, `nosniff`, sandboxing CSP). Allow-list png/jpg/webp, size cap (for example 2 MB), count cap; audit uploads and deletions (no bytes in the audit); delete files when the survey is deleted; document that the volume must be part of backups.

### 3.3 Cross-cutting rules for every item (from `papp-add-feature`)

- Every new setting has `ar` and `en` strings; RTL checked; no raw `toLocaleString`.
- Server re-validation of anything the client enforces.
- New permission codes only if a new capability appears (images may need `survey.surveys.update` only; none planned). No hardcoded role names.
- Audit: builder saves are already audited through `PUT /structure`; upload/delete of images adds its own audit rows (no file bytes).
- Export / import / duplicate must round-trip every new config key (they remap ids, see SURVEY-D10/D11).
- Tests: unit (`validateStructure`, `validateAnswerShape`, `logic-engine`), plus an e2e smoke of one new feature per phase. Tests live inside the module (`modules/survey/test/...`).
- Update `DOCUMENTATION.md` and `DECISIONS.md` in the same pull request as each phase.

## 4. Backlog: everything else, documented

### 4.0 Next up (the features moved out of the top 10)

| Item | Notes |
|---|---|
| **Likert / matrix grid** | Several statements on one shared scale; answer is an object keyed by statement id; report per statement. Needs migration 007 and the question-type column converted to plain text (decision 3), the one-time prerequisite for every later type. Google's options "require a response in each row" and a row-count advice (about 5 to 8) apply. |
| **Shuffle** | Choices per question (stable for one visit, "Other"/"None" last) and question order within a section (disabled when routing is used). Needs the `settings` column for the survey flag. |
| **Printable receipt** | Print-friendly view of the respondent's own answers (browser print); emailed copy is separate (below). |
| **Ranking, NPS** | See 4.1. |
| **Quiz mode** | See 4.2. |

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
- Respondent "save and continue later" (conflicts with the module's deliberate rule that nothing partial is stored, SURVEY-D1/DOC; would need an explicit owner decision).
- CAPTCHA / bot protection on anonymous links (rate limiting exists via the public throttler).

- **Piping and carry-forward** (SurveyMonkey): insert an earlier answer into later text, or reuse the chosen options of one question as the choices of another.
- **Disqualification ("screen-out") end page:** a route that ends the survey with its own message and optionally does not store the response (builds on the existing `submit` route target).
- **Page/block randomisation and response quotas** (SurveyMonkey higher plans).
- **Emailed copy of the answers to the respondent** (Google "send responders a copy"); needs an email field and a template through the notifications service.
- **Basic text formatting and links** in descriptions (bold, italic, link) with strict sanitising; `modules/website` already has a safe-markdown renderer, but modules must not import each other, so this would be a small copy or a platform-level shared component.

### 4.4 Platform-specific items Microsoft does not cover

- **Bilingual surveys.** Owner decision 2026-10-15: **not needed** (one survey per language). Recorded so it is not re-proposed.
- **Reader/member linking.** Tie a response to a library reader (card number) when the respondent is logged in.

### 4.5 Results and administration

- Delete all responses (with confirmation and audit); print/PDF of the summary; more chart types (pie, stacked, trend over time); filters on the report (date range, by answer); response time analytics; respondent-facing "see results" link; shareable read-only results link; scheduled/emailed summary.
- Webhook or API on new response (the offline replacement for Power Automate); CSV export alongside Excel.
- Report filters (date range, completed vs partial, by answer) and crosstab significance testing (SurveyMonkey); the existing pivot already covers plain crosstabs.
- Collaboration: co-owners who can edit one survey (today access is by role permission only).
- Insights / AI summary and "generate a survey from a sentence": only if an external model is approved (privacy decision), otherwise out of scope.
- Templates gallery (starter surveys such as "Event feedback", "Reader satisfaction") shipped as importable packages using the existing zip format (SURVEY-D10): cheap and useful, a good candidate right after phase A.

## 5. Decisions (answered by the owner on 2026-10-15)

1. **Image storage:** files on a mounted disk volume served by the API (allow-listed types and size). Applies to images now and to file-upload questions later. The volume must be included in backups.
2. **Survey-level settings:** one flexible `settings` JSONB column plus real columns only where SQL needs them (`response_limit`).
3. **New question types:** convert the question-type column from a fixed database list to plain text once, in the first migration that adds a type (Likert, backlog 4.0). A JSON column is not needed for this: the type is only a short name, while each type's details already live in the question's JSONB `config`. The top-10 list adds no new type, so this conversion is not part of it.
4. **Priorities:** user experience first (this document's section 3); rarely used features are in the backlog.
5. **Bilingual survey content:** not needed.

Nothing else is blocking: phase A can start.
