# Survey module — documentation

Read `docs/MODULE_SPEC.md` §9 for what this file and `DECISIONS.md` are for and when to update them. Read `DECISIONS.md` in this same directory too — this file is the current shape, that one is why it's shaped that way (including two real bugs found and fixed while building it).

## Purpose

Google-Forms-style survey builder: sections/questions with conditional show/hide logic driven by prior enumeration answers, public or login-required shareable links, optional post-submit editing via a hashed edit token, completion notifications (owner + arbitrary admin-typed addresses), per-question report charts, and a dynamic pivot table over the flattened response dataset.

## Data model

```
survey_surveys(id, title, description, status(draft|published|closed),
  owner_user_id, requires_login, allow_edit_after_submit,
  one_response_per_respondent, notify_owner_on_submit, notify_emails jsonb,
  opens_at, closes_at, created_at, updated_at)
survey_sections(id, survey_id, order_index, title, description)
survey_questions(id, section_id, order_index, type, title, description,
  required, config jsonb)   -- type: short_text|paragraph|single_choice|
                             --       multi_choice|dropdown|linear_scale|
                             --       date|time|rating
survey_question_options(id, question_id, order_index, value, label)
survey_logic_rules(id, survey_id, source_question_id, source_option_value,
  action(show|hide), target_type(section|question), target_id, order_index)
survey_responses(id, survey_id, respondent_user_id NULLABLE,
  respondent_email, edit_token_hash /* @Sensitive */,
  submitted_at, updated_at, ip_address, user_agent)
survey_answers(id, response_id, question_id, value jsonb)
```

- **No draft/partial-response table exists anywhere** — the "abandoned mid-way / session expired → never stored" requirement is satisfied by construction: the frontend never calls a write endpoint until one atomic final submit. In-progress answers live only in React state + `localStorage`.
- `one_response_per_respondent` is enforced in `ResponsesService`, **not** a DB unique index — see `SURVEY-D2` below; there is no unique constraint on `(survey_id, respondent_user_id)` in the migration.
- `edit_token_hash` is the SHA-256 hash of a 32-byte random secret returned to the client **once**, at submit time, exactly like a refresh token — never logged, never returned again, never included in an audit row (see `SURVEY-D4`).
- Multi_choice/linear_scale/rating answer *values* in `survey_answers.value` are JSON (`string[]`/`number`) — `ResponsesService.validateAnswerShape` is the one place that enforces the real shape per question type.

## Permissions

| Code | Gates |
|---|---|
| `survey.surveys.view` | List/get a survey definition |
| `survey.surveys.create` | Create a survey |
| `survey.surveys.update` | Edit settings, save the whole section/question/logic structure |
| `survey.surveys.delete` | Delete a survey (cascades to everything under it) |
| `survey.surveys.publish` | Publish or close a survey |
| `survey.responses.view` | List/view individual responses, view the report/pivot |
| `survey.responses.export` | Download responses as `.xlsx` |
| `survey.responses.delete` | Delete an individual response |

`defaultRolePermissions`: `admin` gets all 8; nothing else does by default (no base role naturally "runs surveys" — grant a custom role from the Permissions page). Filling out a survey needs **no** `survey.*` permission at all — `FillController` has no `@RequirePermission` (any authenticated user) and `PublicSurveyController` is `@Public()`.

## Routes

Backend (`apiPrefix: /api/survey`):
- `GET/POST /surveys`, `GET/PATCH/DELETE /surveys/:id`, `POST /surveys/:id/publish`, `POST /surveys/:id/close`, `PUT /surveys/:id/structure` — `SurveysController`, permission-gated as above.
- `GET/DELETE /surveys/:id/responses[/:responseId]`, `GET /surveys/:id/responses/export`, `GET /surveys/:id/report/summary`, `GET /surveys/:id/report/dataset` — `ResponsesController` (a *second* controller sharing the same path prefix as `SurveysController` — Nest resolves this fine; `export`/`report/*` are declared before `:responseId` so the static segment is never swallowed by the dynamic one).
- `GET/POST /:id/fill` — `FillController`, **no** `@RequirePermission` (any logged-in user, regardless of the survey's own `requiresLogin`).
- `GET/POST/PATCH /public/:id` — `PublicSurveyController`, `@Public()` + `PublicThrottlerGuard` on the writes.

Frontend (`basePath: /survey`):
- `/survey/surveys` (authenticated, `surveys.view`) → `SurveysListPage.tsx`
- `/survey/surveys/:surveyId/edit` (authenticated, `surveys.update`) → `SurveyBuilderPage.tsx`
- `/survey/surveys/:surveyId/responses` (authenticated, `responses.view`) → `SurveyResponsesPage.tsx`
- `/survey/surveys/:surveyId/report` (authenticated, `responses.view`) → `SurveyReportPage.tsx`
- `/survey/:surveyId` (**public**, no permission) → `TakeSurveyPage.tsx` — the one canonical respondent URL, works for both anonymous and logged-in visitors from the same link; the page itself picks which endpoint pair to call from `useAuth()`'s real status (see `SURVEY-D1`).

## Key files

- `backend/logic-engine.ts` — the conditional show/hide evaluator. Zero framework dependency **on purpose**: the backend imports its compiled `.js` sibling to re-validate a submission server-side (defense in depth — never trusts the client's own visibility computation), and the frontend (`TakeSurveyPage.tsx`) imports the raw `.ts` source directly via Vite, so there is exactly one copy of this logic, never two that could drift. Fully unit-tested (`apps/api/test/modules/survey/logic-engine.spec.ts`).
- `backend/responses.service.ts` — the respondent-facing flow shared by both `FillController` and `PublicSurveyController`: fill/submit/edit, server-side answer re-validation, the audit write (done **manually**, not via `@Audit`, on purpose — see `SURVEY-D4`), and the owner/notify-emails dispatch.
- `backend/surveys.service.ts` — builder/admin CRUD + `replaceStructure` (the whole-tree upsert-by-client-generated-UUID save) + `validateStructure` (structure-level validation, independently unit-tested with no dist imports).
- `backend/reports.service.ts` — per-question aggregate summary, the flattened dataset the frontend's pivot table consumes, and the xlsx export.
- `frontend/pages/TakeSurveyPage.tsx` — the respondent UI: live visibility via `logic-engine.ts`, `localStorage` draft + submitted-answer/edit-token persistence, the `requiresLogin` upfront gate.
- `frontend/pages/SurveyReportPage.tsx` — per-question `recharts` charts + the bespoke rows/columns/aggregation pivot table (not a pivot-table library).

## Known gotchas

- **`AnswerInputDto.value: unknown` needs `@IsDefined()`, or every submitted answer is silently dropped** — the global `ValidationPipe`'s `whitelist: true` strips any DTO field with zero `class-validator` decorators, even a deliberately loosely-typed one. See `SURVEY-D5` / root `D67` for the full story; if you add a new DTO field with a genuinely-any-shape value, decorate it with at least `@IsDefined()`.
- **`SurveysService.replaceStructure`'s `deleteMany` calls must never use a non-UUID sentinel for "empty keep-list"** — a section/question with zero children (a text-only survey has zero options anywhere) is common, not an edge case. See `SURVEY-D3` / root `D66`.
- **`one_response_per_respondent` is enforced in `ResponsesService`, not a DB constraint** — it's a per-survey admin toggle, so it can't be. See `SURVEY-D2` / root `D66`.
- **An anonymous respondent is never deduplicated at all**, by design — `one_response_per_respondent` only has teeth for a known (logged-in) respondent. Don't try to "fix" this for anonymous visitors; it's a real, honestly-scoped limitation (anonymity and deduplication are fundamentally in tension), not an oversight.
- **`FillController`'s `MustChangePasswordGuard` would 403 a forced-password-change account** even though `AuthContext`'s own `status` still reads `'authenticated'` for it — `TakeSurveyPage.tsx` checks `mustChangePassword` too (`canUseAuthenticatedFlow`) and routes that case through the public endpoints instead.
- **`linear_scale`/`rating` questions with an empty `config`** default to a 1–5 range client-side (`TakeSurveyPage.tsx`'s `QuestionInput`) — the builder lets you override `min`/`max`, but a question saved without ever touching those fields still renders sensibly.
- **`modules/**` has no lint or unit-test coverage from any tool in this repo, and a Jest unit test cannot import `ResponsesService` at all** (it constructor-injects three `apps/api/dist/**` classes, which throws under this repo's Jest/Node combination the moment anything requires `@nestjs/common` from compiled `.js`) — see root `D68`. `logic-engine.ts` and `SurveysService.validateStructure` are unit-tested directly; `ResponsesService`'s actual behavior is covered by `apps/web/tests/e2e/survey.spec.ts` instead.

## How to extend

- **A new question type**: add it to `SURVEY_QUESTION_TYPES` (backend `dto/survey-structure.dto.ts` AND frontend `api.ts` — kept as two independent literal arrays, must stay in sync by hand), add a case to `ResponsesService.validateAnswerShape` (answer-shape validation), a case to `TakeSurveyPage.tsx`'s `QuestionInput` (respondent-facing input), and a branch in `ReportsService.getSummary` (how it aggregates) — plus new `survey.question_type.<type>` locale keys in both `ar.json`/`en.json`.
- **A new report aggregation**: extend `ReportsService.getSummary`'s per-type branch, or add a new pivot "value" option in `SurveyReportPage.tsx`'s `PivotTable` (currently count-or-average-of-a-numeric-question).
- **A new notify channel**: extend `ResponsesService.notifyOnSubmit` — it already has the pattern for a real in-app+email send (`NotificationsService`, D21-compliant) alongside a module-owned direct-transport send (`NotificationEmailService`, root `D64`).
