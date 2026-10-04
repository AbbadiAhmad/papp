# Library Circulation & Finance module — documentation

Read `docs/MODULE_SPEC.md` §9 for what this file and `DECISIONS.md` are for and when to update them. Read `DECISIONS.md` in this same directory too — this file is the current shape, that one is why it's shaped that way.

## Purpose

The borrowing/returning/fines/payments half of the Library domain (`docs/LIBRARY_MODULE_REQUIREMENTS.md`), built on top of `library_catalog`'s books/copies (`dependsOn: ["library_catalog"]`, root D44). Combines `library_circulation` (students, scan/borrow/return, fines) and `library_finance` (transactions/payments/receipts) into ONE module, per D44 — they share one manifest, one Prisma client, one migration.

## Data model

```
library_academic_years(id, label, start_date, end_date, is_current, created_at)
library_students(id, user_id -> users(id) UNIQUE, code UNIQUE, class_name, academic_year_id, created_at, updated_at)
library_fine_types(id, code UNIQUE, name, default_amount, is_active)          -- seeded: FINE-LATE/DAMAGE/LOST/OTHER
library_borrowings(
  id, book_copy_id -> library_catalog_book_copies(id), student_id -> library_students(id),
  status TEXT CHECK(active|returned|overdue|lost|cancelled),
  borrowed_at, due_at, returned_at, borrowed_by -> users(id), returned_by -> users(id)
)
library_fines(
  id, fine_number UNIQUE, student_id, borrowing_id, fine_type_id,
  status TEXT CHECK(unpaid|partially_paid|paid|waived|cancelled),
  amount, amount_paid, notes, created_by, created_at
)
library_financial_transactions(id, fine_id, transaction_number UNIQUE, amount, created_at)  -- one per fine, the "charge"
library_payments(id, payment_number UNIQUE, transaction_id, amount, payment_method CHECK(cash|card|transfer), paid_at, received_by)  -- the "money received"
library_receipts(id, payment_id UNIQUE, receipt_number UNIQUE, issued_at)                   -- one per payment
```

- A "student" is a REAL platform `User` with the `reader` role (root D41) — `library_students` only adds the library-specific fields. `StudentsService.create()` creates both the `users` row (argon2id-hashed random temporary password, `mustChangePassword: true`) and the `library_students` row in one transaction — the librarian's actual workflow, not two separate steps.
- "Staff" needs no table: a staff member is a platform `User` with `library_assistant`/`finance` — every table above that needs "who did this" carries its own `borrowed_by`/`returned_by`/`created_by`/`received_by` pointing at `users(id)`, for direct display without an audit-log join.
- Full history is never deleted (§10) — `StudentsService.remove()` rejects deleting a student with any borrowing history (§22); nothing deletes a `library_borrowings`/`library_fines` row, ever.
- `status` columns are `TEXT` + `CHECK`, not a Postgres `ENUM` (unlike `library_catalog`'s `LIBRARY_CATALOG-D5`) — deliberate, see `DECISIONS.md`.
- `fine_number`/`transaction_number`/`payment_number`/`receipt_number` are genuinely sequential (Postgres `SEQUENCE`s: `library_fine_number_seq` etc., migration `002`), formatted `<PREFIX>-000123` by `FinesService.nextNumber()` — matches the librarian's own worked example format (`LIBRARY_CIRCULATION-D8`).

## Permissions

| Code | Gates |
|---|---|
| `library_circulation.students.view/create/update/delete` | Students CRUD |
| `library_circulation.borrow` / `.return` / `.extend` | The three circulation actions, and `/scan` (gated on `.borrow`) |
| `library_circulation.fines.view/record/waive` | Fines list/detail, manual fine creation, waiving |
| `library_circulation.finance.view/record_payment` | Transactions/payments read, recording a payment |
| `library_circulation.settings.update` | The `loan_policy` setting |
| `library_circulation.dashboard.view` | `GET /dashboard` (§18's stat cards) |

`defaultRolePermissions`: `admin` all; `library_assistant` gets students CRUD + borrow/return/extend + `fines.view` + `dashboard.view` (NOT `fines.record`/`fines.waive` — §1: "optionally grantable", admin grants per-instance); `finance` gets `fines.view` + both `finance.*` + `dashboard.view`; `reader` none.

## Settings

`library_circulation.loan_policy` (`{ maxBooksPerStudent, loanPeriodDays, finePerDay }`) — read/written through `backend/settings.service.ts`'s own minimal endpoint (root D70/D71: the generic per-module Settings-screen surface doesn't exist yet), never hardcoded. This is THE concrete case (`docs/LIBRARY_MODULE_REQUIREMENTS.md` §8) that motivated building the module-`settings` manifest mechanism in the first place.

## Key files

- `backend/circulation.service.ts` — scan (prefix-dispatch STU/BOOK, §6)/borrow/return/extend, the per-student borrowing-limit protection rule (§22), late-day computation, copy-stats aggregate for the dashboard, borrow/return/extend notifications. `extendLoan()` (LIBRARY_CIRCULATION-D22): staff-picked new due date (must be after the current one), no cap on repeat extensions, no dedicated `extended_by` column — the audit log already captures the actor.
- `backend/students.service.ts` — creates the linked `User` + `library_students` row together; blocks delete-with-history.
- `backend/fines.service.ts` — fine creation (manual + auto-on-late-return) with duplicate-open-fine prevention (§14/§22), payments with the overpayment guard, receipt issuance, sequence-backed reference numbers (`nextNumber()`), finance-summary aggregate for the dashboard, fine/payment notifications.
- `backend/notifications-sender.ts` — the `NOTIFICATIONS_SENDER` injection token + structural interface `circulation.service.ts`/`fines.service.ts` depend on instead of importing the real `NotificationsService` directly (keeps them unit-testable — root D74, read this file's own docblock before touching notification wiring).
- `backend/dashboard.controller.ts` — `GET /dashboard` (§18), combining all three services' own stat methods.
- `backend/*.controller.ts` — four controllers (`students`, `circulation`, `fines`, `dashboard`) plus `settings`, sharing one manifest/module.
- `frontend/pages/ScanPage.tsx` — the daily-use screen (§6/§30): two scan slots (student/book), then one confirm action. All three of §6's input methods are real: `CameraScanDialog.tsx` (camera), a USB keyboard-wedge scanner (free — same text field), manual typing. When the scanned copy has an active borrowing, an Extend button (`library_circulation.extend`, `ExtendLoanDialog.tsx`) sits next to Confirm Return. Also renders the optional `reading_club` reward hook (see `readingClubIntegration.ts` below) right under the reader section once a student is scanned.
- `frontend/readingClubIntegration.ts` — a small, deliberately import-free (raw `apiClient` calls, never a static TS import of `modules/reading_club/**`) helper this page uses to show "reader finished a reading-club stage, reward pending" and let staff confirm it was handed over, right when the reader is next physically present. Entirely optional: hidden whenever the `reading_club` module isn't installed or the caller lacks its permission — see `DECISIONS.md`.
- `frontend/pages/StudentDetailPage.tsx` — the reader's active-books/fines tabs (§25/§10); the "Currently borrowed" tab's Actions column also opens `ExtendLoanDialog.tsx` per row.
- `frontend/pages/QrCodeImage.tsx` — client-side QR image rendering (`qrcode` npm package) for a student's own code.
- `frontend/pages/DashboardPage.tsx` — §18's stat cards, reading `GET /dashboard`.

## Known gotchas / deliberate v1 scope cuts (read before extending)

- **`overdue` is a valid `library_borrowings.status` value but nothing proactively sets it** — no scheduler/cron infrastructure exists anywhere in this platform yet. Lateness is instead computed on demand at return time (`returnedAt - dueAt`) for the fine calculation; a "currently overdue" list would need to derive it live (`status = 'active' AND due_at < now()`), not query `status = 'overdue'`. Don't add a cron job to "fix" this without raising it with the user first — it's a platform-wide gap, not this module's alone.
- **STAFF/FINE scan prefixes are not implemented** — only STU (student) and BOOK (copy) are recognized, because those are the only two the borrow/return flow actually needs (§7/§9) and no code scheme for staff or fines exists anywhere. Don't invent one silently if a future requirement needs it; raise it with the user.
- **`library_academic_years` has a Prisma model and a nullable FK on `library_students`, but no CRUD endpoint** — §34 flags academic years as a genuinely new concept not required for the core borrow/return/fine/payment flow; the column exists so it isn't a breaking schema change later, but populating it today requires a direct DB insert. Build the CRUD surface when multi-year support is actually prioritized.
- **No `library_classes`/grades lookup entity** — `className` stays free text; add it together with Excel import (see `LIBRARY_CIRCULATION-D9`), not before.
- **No Excel import/export for students/history/fines/financial (§15-17)** — D42's reused Phase-2 import pattern is deferred; this is a real, intentionally deferred follow-up phase, not an oversight.
- **§19's deeper reading-analytics breakdowns and §20's per-staff activity report are not built** — the `GET /dashboard` endpoint covers §18's stat cards only, not a reporting suite.
- **Global search across students/books/fines/transactions (§24) is not built** — each entity has its own list endpoint; a unified search endpoint is a follow-up.
- **Batch QR/barcode + card/spine-label printing (§28) is not built for STUDENTS** — `QrCodeImage.tsx` here still renders one code at a time (student create dialog / detail page), not a batch/print layout. The BOOK/copy half of this same gap is now closed, but in `library_catalog`, not here — `library_catalog`'s own `PrintCodesPage.tsx` (LIBRARY_CATALOG-D22) filters copies by acquisition date and prints/exports a batch of copy stickers (QR + code + location). If student batch-card printing is prioritized later, build it the same way (a dedicated print page in whichever module owns the student record), not by extending this flag.
- **Notification content is hardcoded Arabic text**, not an operator-editable `system_settings` template like core's password-reset notice — root ASSUMPTIONS.md A15.
- **`Html5Qrcode.start(cameraIdOrConfig, config, ...)`'s FIRST argument is NOT a general `MediaTrackConstraints` bag — it accepts EXACTLY ONE key, `facingMode` or `deviceId`, and throws if given more** (confirmed by reading `html5-qrcode`'s own `createVideoConstraints()`). A constraint like the near-focus `advanced: [{focusMode, focusDistance}]` request (`NEAR_FOCUS_VIDEO_CONSTRAINTS` in `CameraScanDialog.tsx`) goes in the SECOND argument's `videoConstraints` field instead — that one really is passed straight through to `getUserMedia` with no key-count limit. Passing it as part of the first argument's object broke camera scanning outright, on EVERY platform, from the exact commit that added it (LIBRARY_CIRCULATION-D36) — it only looked platform-specific because two earlier diagnosis passes (D34, D35) each produced a plausible-but-wrong theory (an unrelated secure-context check; a guess that WebKit rejects the constraint — neither ever confirmed) for what was actually the same unchanging `.start()`-always-throws bug, and a from-scratch misdiagnosis cost less than re-confirming a theory the user's own retest had already disproven. **General lesson**: a library wrapping a native browser API does not necessarily accept that native API's own argument shape for every parameter it forwards — check the wrapper's source for what EACH argument actually does before trusting a type that merely looks similar (`MediaTrackConstraints`-shaped).
- **`navigator.mediaDevices`/`getUserMedia` genuinely doesn't exist outside a secure context** (`https:` or `localhost`) in any browser — a real W3C restriction `CameraScanDialog.tsx` checks for up front, showing `camera_insecure_context_error` instead of the misleading generic `camera_error`. This is DORMANT for the current dev setup (reached via `localhost` through Docker port-forwarding, which the spec exempts) and was never the cause of any camera bug actually reported (LIBRARY_CIRCULATION-D34, ruled out by D36) — it only matters if this app is ever served over plain HTTP via a non-`localhost` address (a LAN IP, a public hostname without TLS). Don't read its presence in the code as "this deployment needs HTTPS" — it doesn't, today; it's forward-looking hardening for a scenario that hasn't happened yet.
- **The committed `backend/*.js` can drift from `backend/*.ts`** — found via LIBRARY_CIRCULATION-D22's rebuild: several `.js` files were stale relative to their own `.ts` source (missing already-reviewed features entirely: borrow's `expectedReturnDate`/`comments`, return's status/notes handling, `getCirculationHistory`, `ParseUUIDPipe` on `:id` routes). Since `backend.entry` in the manifest runs the `.js`, this meant the real running app silently lacked functionality its source code already had. Any change to a `backend/*.ts` file must be followed by `npx tsc -p modules/library_circulation/tsconfig.json` (which recompiles the WHOLE module in place, not just the file you touched) — never hand-edit a `.js` file, and never assume an existing `.js` is actually in sync with its `.ts` without recompiling to check.

## Down migrations (root D48 / D86)

`migrations/down/001_create_library_circulation_tables.sql` through `down/005_add_return_statuses.sql` now exist — the structural inverse of each same-numbered up-migration, applied in descending filename order (`005` → `004` → `003` → `002` → `001`) by `ModuleRegistryService.runDownMigrationsIfPresent` when an admin uninstalls this module with `--drop-data`. `005`'s down drops the `return_status`/`return_notes` columns + their CHECK constraint; `004`'s down drops the `circulation_history` column/GIN index; `003`'s down drops the `comments` column; `002`'s down drops the `fine_number`/`payment_number`/`payment_method` columns, their UNIQUE constraints, and the four number sequences; `001`'s down drops every table this module created (`library_receipts` down through `library_academic_years`, child-before-parent). Before this, `--drop-data` on this module silently left every table in place. See root D86 for the platform-level dependency guard added alongside this: uninstalling `library_catalog` while this module still depends on it (or uninstalling this module while `reading_club` still depends on it) is now rejected outright, not just a `DOCUMENTATION.md` warning.

## How to extend

Read `docs/LIBRARY_MODULE_REQUIREMENTS.md` in full first — it's the already-resolved librarian requirements doc this module implements section by section; the "Known gotchas" list above enumerates exactly which of its sections are still open. Follow `docs/FEATURE_TEMPLATE.md` for any new endpoint (permission → guard → audit → locale keys in `ar`+`en` → tests).
