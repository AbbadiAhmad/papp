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
  id, student_id, borrowing_id, fine_type_id,
  status TEXT CHECK(unpaid|partially_paid|paid|waived|cancelled),
  amount, amount_paid, notes, created_by, created_at
)
library_financial_transactions(id, fine_id, transaction_number UNIQUE, amount, created_at)  -- one per fine, the "charge"
library_payments(id, transaction_id, amount, paid_at, received_by)                          -- the "money received"
library_receipts(id, payment_id UNIQUE, receipt_number UNIQUE, issued_at)                   -- one per payment
```

- A "student" is a REAL platform `User` with the `reader` role (root D41) — `library_students` only adds the library-specific fields. `StudentsService.create()` creates both the `users` row (argon2id-hashed random temporary password, `mustChangePassword: true`) and the `library_students` row in one transaction — the librarian's actual workflow, not two separate steps.
- "Staff" needs no table: a staff member is a platform `User` with `library_assistant`/`finance` — every table above that needs "who did this" carries its own `borrowed_by`/`returned_by`/`created_by`/`received_by` pointing at `users(id)`, for direct display without an audit-log join.
- Full history is never deleted (§10) — `StudentsService.remove()` rejects deleting a student with any borrowing history (§22); nothing deletes a `library_borrowings`/`library_fines` row, ever.
- `status` columns are `TEXT` + `CHECK`, not a Postgres `ENUM` (unlike `library_catalog`'s `LIBRARY_CATALOG-D5`) — deliberate, see `DECISIONS.md`.

## Permissions

| Code | Gates |
|---|---|
| `library_circulation.students.view/create/update/delete` | Students CRUD |
| `library_circulation.borrow` / `.return` | The two circulation actions, and `/scan` (gated on `.borrow`) |
| `library_circulation.fines.view/record/waive` | Fines list/detail, manual fine creation, waiving |
| `library_circulation.finance.view/record_payment` | Transactions/payments read, recording a payment |
| `library_circulation.settings.update` | The `loan_policy` setting |

`defaultRolePermissions`: `admin` all; `library_assistant` gets students CRUD + borrow/return + `fines.view` (NOT `fines.record`/`fines.waive` — §1: "optionally grantable", admin grants per-instance); `finance` gets `fines.view` + both `finance.*`; `reader` none.

## Settings

`library_circulation.loan_policy` (`{ maxBooksPerStudent, loanPeriodDays, finePerDay }`) — read/written through `backend/settings.service.ts`'s own minimal endpoint (root D70/D71: the generic per-module Settings-screen surface doesn't exist yet), never hardcoded. This is THE concrete case (`docs/LIBRARY_MODULE_REQUIREMENTS.md` §8) that motivated building the module-`settings` manifest mechanism in the first place.

## Key files

- `backend/circulation.service.ts` — scan (prefix-dispatch STU/BOOK, §6)/borrow/return, the per-student borrowing-limit protection rule (§22), late-day computation.
- `backend/students.service.ts` — creates the linked `User` + `library_students` row together; blocks delete-with-history.
- `backend/fines.service.ts` — fine creation (manual + auto-on-late-return) with duplicate-open-fine prevention (§14/§22), payments with the overpayment guard, receipt issuance.
- `backend/*.controller.ts` — three controllers (`students`, `circulation`, `fines`) sharing one manifest/module, mirroring the manifest's own grouping.
- `frontend/pages/ScanPage.tsx` — the daily-use screen (§6/§30): two scan slots (student/book), then one confirm action.

## Known gotchas / deliberate v1 scope cuts (read before extending)

- **Camera/USB barcode capture is NOT implemented** — `ScanPage`'s input is a plain text field (works with any keyboard-wedge USB scanner already, since those just emit keystrokes + Enter, but there's no camera-based QR reading). A real camera integration is its own sizeable browser-permissions/library feature; add it as a fast-follow, not by growing this text field.
- **`overdue` is a valid `library_borrowings.status` value but nothing proactively sets it** — no scheduler/cron infrastructure exists anywhere in this platform yet. Lateness is instead computed on demand at return time (`returnedAt - dueAt`) for the fine calculation; a "currently overdue" list would need to derive it live (`status = 'active' AND due_at < now()`), not query `status = 'overdue'`. Don't add a cron job to "fix" this without raising it with the user first — it's a platform-wide gap, not this module's alone.
- **STAFF/FINE scan prefixes are not implemented** — only STU (student) and BOOK (copy) are recognized, because those are the only two the borrow/return flow actually needs (§7/§9) and no code scheme for staff or fines exists anywhere. Don't invent one silently if a future requirement needs it; raise it with the user.
- **`library_academic_years` has a Prisma model and a nullable FK on `library_students`, but no CRUD endpoint** — §34 flags academic years as a genuinely new concept not required for the core borrow/return/fine/payment flow; the column exists so it isn't a breaking schema change later, but populating it today requires a direct DB insert. Build the CRUD surface when multi-year support is actually prioritized.
- **No Excel import/export for students/history/fines/financial (§15-17, §19)** — D42's reused Phase-2 import pattern and the reporting/analytics dashboards (§18-20) are deferred; `FinancePage`/`FinesPage` are plain read tables, not the full reporting suite. This is a real, intentionally deferred follow-up phase, not an oversight — every flow that IS built (scan/borrow/return/fine/pay) is fully real, no mock data, no partial implementation.
- **Global search across students/books/fines/transactions (§24) is not built** — each entity has its own list endpoint; a unified search endpoint is a follow-up.
- **Batch QR/barcode + card/spine-label printing (§28) is not built.**

## How to extend

Read `docs/LIBRARY_MODULE_REQUIREMENTS.md` in full first — it's the already-resolved librarian requirements doc this module implements section by section; the "Known gotchas" list above enumerates exactly which of its sections are still open. Follow `docs/FEATURE_TEMPLATE.md` for any new endpoint (permission → guard → audit → locale keys in `ar`+`en` → tests).
