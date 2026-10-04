# Library Catalog module — documentation

Read `docs/MODULE_SPEC.md` §9 for what this file and `DECISIONS.md` are for and when to update them. Read `DECISIONS.md` in this same directory too — this file is the current shape, that one is why it's shaped that way.

## Purpose

Book catalog: titles and their individually-tracked physical copies (by QR code), with categories/authors/reading level, plus one public shareable link so anyone can check a specific copy's availability without logging in. Borrowing/returning/fines are **deliberately out of scope** — see Known gotchas.

## Data model

```
library_catalog_books(
  id, title, author, publisher, category, reading_level, language,
  description, cover_image, page_count, created_at, updated_at
)
library_catalog_book_copies(
  id, book_id -> books(id) ON DELETE CASCADE,
  qr_code UNIQUE, status ENUM(available|borrowed|lost|damaged|maintenance|reserved),
  condition, location, acquisition_date, created_at, updated_at,
  history JSONB[] DEFAULT '[]'
)
library_catalog_copy_code_seq  -- Postgres SEQUENCE (not a table), migration 006 (LIBRARY_CATALOG-D22)
library_catalog_book_ratings(
  id, book_id -> books(id) ON DELETE CASCADE, user_id -> users(id),
  rating SMALLINT CHECK(1-5), review TEXT NULL,
  review_status TEXT CHECK(pending|approved|rejected) DEFAULT 'approved',
  moderated_by -> users(id) NULL, moderated_at NULL,
  created_at, updated_at, UNIQUE(book_id, user_id)
)
```

- `status` is a real Postgres `ENUM` (`library_catalog_book_copy_status`), not a `TEXT` + `CHECK` — required for Prisma's `enum` mapping (see the migration's own comment; the same lesson core's `0000`/`0005` migrations already learned).
- Deleting a book **cascades** to its copies — a copy cannot outlive its title. A future circulation module deciding to block that delete when a copy has borrowing history is that module's job, not this one's (see Known gotchas).
- `updated_at` exists on both tables specifically so `@Audit`'s before/after diff on an `update` has more than just the one changed field to show.
- `history` (Feature 2.1 — D18) is a JSONB array tracking up to 100 most recent changes to `status`, `condition`, and `location`. Each entry records `{ timestamp, changes: { field: { before, after } } }`. The `getCopyHistory` endpoint retrieves these entries. See DECISIONS.md D18 for the migration application process.
- `library_catalog_book_ratings` (LIBRARY_CATALOG-D20) is one row per (book, user) — `UNIQUE(book_id, user_id)`, `rating` a plain `SMALLINT` + `CHECK` (not a Prisma `enum` — no need for one, unlike copy `status`), `review` optional free text. `user_id` is a plain scalar column with no Prisma relation to the core `User` model; the rater's display name is joined in `BooksService` via a separate `prisma.user.findMany` call, not a Prisma `include`. Re-rating UPSERTs the same row — there is never a second rating row for the same reader/book pair. Deleting a book cascades to its ratings (`ON DELETE CASCADE`, same as copies).
- `review_status`/`moderated_by`/`moderated_at` (LIBRARY_CATALOG-D21 — "the librarian has to approve the comments to publish it") gate only the WRITTEN review text; the numeric `rating` always counts toward the average the moment it's submitted, moderated or not. Defaults to `'approved'` so a bare star rating (no review) never needs moderation. See "Review moderation" under Routes below for the full workflow.
- `library_catalog_copy_code_seq` (LIBRARY_CATALOG-D22) — a Postgres `SEQUENCE`, not a table/column. `BooksService.nextCopyCode()` consults it (`SELECT nextval(...)`) to auto-assign a `Bxxxxxx` (6-digit zero-padded) `qr_code` whenever a copy is created with that field blank — `qr_code` itself stays a plain `TEXT UNIQUE` column with no DB-level `DEFAULT`, since the "B" + zero-pad formatting happens in application code. The librarian can still type in their own value instead; the sequence is only consulted when the field is omitted/blank.
- `page_count` (LIBRARY_CATALOG-D24, migration 007) — optional `INTEGER CHECK(page_count > 0)`. Recorded on the Add/Edit Book form, shown on the book's detail page and in the Excel export. Consumed by the `reading_club` module: when a reader returns a borrowed copy, the book's `page_count` is snapshotted onto that stage's auto-created `reading_club_stage_book_entries` row, and summed across a stage's entries to auto-compute a `pages`-type stage's progress (see that module's own DECISIONS.md READING_CLUB-D18). A book with no `page_count` set (NULL) contributes 0 toward that sum, never an error — this field is never required.

## Permissions

| Code | Gates | Checked in |
|---|---|---|
| `library_catalog.books.view` | List/get a book, list a book's copies | `BooksController.list/findById/listCopies` |
| `library_catalog.books.create` | Create a book, add a copy to a book | `BooksController.create/addCopy` |
| `library_catalog.books.update` | Edit a book, update a copy's status/condition/location | `BooksController.update/updateCopy` |
| `library_catalog.books.delete` | Delete a book (and, via cascade, its copies), or remove a single copy directly | `BooksController.remove/removeCopy` |
| `library_catalog.books.export` | Download the books list as `.xlsx` | `BooksController.export` |
| `library_catalog.books.rate` | Create/update/delete the CALLER'S OWN rating+review for a book (never someone else's) | `BooksController.rateBook/removeRating` |
| `library_catalog.books.moderate_ratings` | List the pending-review queue, approve or reject a review | `BooksController.listPendingReviews/approveReview/rejectReview` |
| `library_catalog.copies.print_codes` | View/filter copies for printing, print the sticker sheet, export the Excel sheet, READ the sticker header-text setting | `BooksController.listCopiesForPrint/exportCopiesForPrint`, `SettingsController.getStickerSettings` |
| `library_catalog.copies.inventory` | View/filter the copies inventory list, export its Excel sheet (LIBRARY_CATALOG-D25) | `BooksController.listCopiesForInventory/exportCopiesForInventory` |
| `library_catalog.settings.update` | WRITE the sticker header-text setting | `SettingsController.updateStickerSettings` |

`defaultRolePermissions`: `admin` gets all 10; `library_assistant` gets view/create/update/rate/moderate_ratings/print_codes/inventory (no delete/export/settings.update); `finance` gets none; `reader` gets view+rate (never moderation — moderating is a librarian/admin action). The public availability route (below) needs no permission at all — there is no user to check one against. `books.rate`/`books.moderate_ratings` are intentionally NOT hardcoded to any one role — see DECISIONS.md D20/D21: whoever holds the code can do the action, matching every other permission-gated action on this platform. Same reasoning extends to `copies.print_codes`/`settings.update` (LIBRARY_CATALOG-D22) and `copies.inventory` (LIBRARY_CATALOG-D25).

## Settings

`library_catalog.sticker_header_text` (`{ headerText }`) — the fixed header line printed on every copy sticker (e.g. the school/library name, blank by default). Read/written through `backend/settings.service.ts`'s own minimal endpoint (root D70/D71: the generic per-module Settings-screen surface doesn't exist yet, same pattern as `library_circulation`'s `loan_policy`). This is this module's FIRST `system_settings`-backed value (LIBRARY_CATALOG-D22).

## Routes

Backend (`apiPrefix: /api/library`):
- `GET/POST /books`, `GET/PATCH/DELETE /books/:id`, `GET /books/export` — `BooksController`, all `@RequirePermission`-gated as above.
- `GET/POST /books/:bookId/copies`, `PATCH/DELETE /books/:bookId/copies/:id` — same controller, copies sub-resource. `DELETE` is gated by `books.delete` (not a separate code, matching the sub-resource pattern), and fails with 409 if the copy has `library_circulation` borrowing history (no `ON DELETE CASCADE` on that FK — see LIBRARY_CATALOG-D8).
- `GET /public/books/:id/availability` — `PublicBooksController`, `@Public()` + `PublicThrottlerGuard` (D34 — even though it's a read, applied "for consistency" per the module's own build notes) + `@Audit(...)` (deliberately, to exercise the `actor_type='anonymous'` audit path — see that controller's own docblock).
- `PUT/DELETE /books/:bookId/rating` — `BooksController`, `books.rate`-gated, always the CALLER's own rating (`@CurrentUser()`, never a `:userId` param). `GET /books/:id` (`findById`) already returns the full ratings list + live average + the caller's own `myRating` — there is no separate `GET .../ratings` list route.
- `GET /books/ratings/pending`, `POST /books/ratings/:ratingId/approve`, `POST /books/ratings/:ratingId/reject` — `BooksController`, `books.moderate_ratings`-gated. See "Review moderation" below for the full workflow these implement.
- `GET /books/copies/stickers`, `GET /books/copies/stickers/export`, `GET/PUT /settings/sticker` — `BooksController`/`SettingsController`. See "Print Codes / sticker printing" below for the full workflow.
- `GET /books/copies/inventory`, `GET /books/copies/inventory/export` — `BooksController`, `copies.inventory`-gated (LIBRARY_CATALOG-D25). Filters by `status`/`location`/book-title substring (never acquisition date — that's the sticker workflow's own filter above); returns `{ id, qrCode, bookTitle, location, status, condition }[]`, sorted by book title then copy code.

### Review moderation — how a librarian approves (or rejects) a comment (LIBRARY_CATALOG-D21)

**The rule**: a reader's star rating (1-5) is never gated — it's added to a book's average the instant it's submitted. Only the WRITTEN review text needs a librarian's approval before anyone besides its own author can see it.

1. A reader (or anyone holding `library_catalog.books.rate`) submits a rating + optional review from the book detail page (`PUT /api/library/books/:bookId/rating`). If they left the review blank, nothing further happens — `reviewStatus` is `'approved'` by default and the rating shows immediately. If they wrote a review, the row is saved with `reviewStatus = 'pending'` — visible only to that reader on their own book page (with an "Awaiting approval" chip) until it's moderated.
2. Anyone holding `library_catalog.books.moderate_ratings` (`admin`/`library_assistant` by default) opens **Library → Moderate reviews** (`/library/reviews/moderate`, `ModerateReviewsPage.tsx`) — this calls `GET /api/library/books/ratings/pending`, which lists every pending review across every book (book title, reviewer name, star rating, the comment text, when it was submitted).
3. Clicking **Approve** (`POST /api/library/books/ratings/:ratingId/approve`) sets `reviewStatus = 'approved'`, records `moderatedBy`/`moderatedAt`, and the comment becomes visible to everyone on that book's page immediately. Clicking **Reject** (`POST /.../reject`) sets `reviewStatus = 'rejected'` instead — the comment stays hidden from everyone but its own author (who sees a "Rejected" chip); the star rating is completely unaffected either way.
4. If the reader later EDITS their review text, it resets to `'pending'` again (and clears the old `moderatedBy`/`moderatedAt`) — a previously-approved comment can never silently stay published after being changed. Editing only the star value (leaving the same review text) does **not** reset an already-moderated review. Clearing the review text entirely returns `reviewStatus` to `'approved'` — there's nothing left to moderate.
5. Both actions are `@Audit`-logged (`category: 'library_catalog.ratings'`, `action: 'approve_review'`/`'reject_review'`) — the audit log itself is the permanent record of who approved/rejected which comment and when, in addition to the `moderated_by`/`moderated_at` columns on the row.

### Print Codes / sticker printing (LIBRARY_CATALOG-D22)

"filter the books entered last period ... export the book names, copy-number and the QR for the copies ... the aim is to print the book stickers."

1. `GET /books/copies/stickers?from=&to=` (`copies.print_codes`) — both bounds optional/inclusive, filtering on `acquisitionDate`; returns `{ id, qrCode, location, acquisitionDate, bookTitle }[]` sorted oldest-acquired-first. `bookTitle` exists ONLY so the librarian can visually verify the filtered set before printing/exporting — it is never rendered on the sticker itself (confirmed with the user explicitly: "the book title is for validation when exporting, not part of the sticker").
2. `GET /books/copies/stickers/export` (same permission, same filter params) — an `.xlsx` download with columns `book_title | copy_code | location | acquisition_date` (QR as plain text, not an embedded image — same ExcelJS-cell limitation already accepted by `exportBooksWorkbook`).
3. `PrintCodesPage.tsx` (`frontend/pages/PrintCodesPage.tsx`) renders the same filtered set as an actual printable sticker SHEET using `window.print()` + a `@media print` stylesheet — a fixed 4-per-row label grid (45mm × 30mm per sticker, an explicit `@page { size: A4; margin: 10mm }` so the printable width is deterministic, not admin-configurable in this first version, confirmed with the user). Each sticker shows: the configured header text (below), a real client-side QR image (`QrCodeImage.tsx`, duplicated from `library_circulation`'s own component — see that file's docblock for why), the copy's code as plain text, and its `location` — never the book title. **Sizing history**: the original size was 63.5mm × 38.1mm at 3-per-row — found, via user report, to already not actually fit (3 × 63.5mm barely fits a page's usable width with margins, and `grid-template-columns: repeat(3, 1fr)`'s elastic columns were silently narrower than the sticker's own fixed width on anything but the very first row, wrapping the code text). Shrunk to the current 45mm × 30mm / 4-per-row size specifically so the arithmetic genuinely fits, with FIXED (not `1fr`) grid columns and `white-space: nowrap` + ellipsis truncation on the free-text header/location fields so neither can wrap again regardless of content length.
4. `GET/PUT /settings/sticker` (`library_catalog.sticker_header_text`) — the fixed header line printed on every sticker (e.g. the school/library name). GET is gated by `copies.print_codes` (anyone who can print needs to be able to see the configured header, even if they can't change it); PUT is gated by the separate `settings.update` (an admin-level config change). Lives in THIS module, not `library_circulation` — confirmed with the user: it's copy/sticker content, and this module already owns the copy data it prints alongside, even though `library_circulation` was where QR rendering/printing was originally built (A14).

Frontend (`basePath: /library`):
- `/library/books` (authenticated, `books.view`) → `BooksListPage.tsx`
- `/library/books/:bookId` (authenticated, `books.view`) → `BookDetailPage.tsx`
- `/library/reviews/moderate` (authenticated, `books.moderate_ratings`) → `ModerateReviewsPage.tsx` — the approval queue described above.
- `/library/copies/print-codes` (authenticated, `copies.print_codes`) → `PrintCodesPage.tsx` — the filter/preview/print/export page described above.
- `/library/copies/inventory` (authenticated, `copies.inventory`) → `CopiesInventoryPage.tsx` — the Annual-inventory filter/table/export page (LIBRARY_CATALOG-D25).
- `/library/public/books/:bookId/availability` (**public**) → `PublicBookAvailabilityPage.tsx` — mounted in every `AppRoutes` branch (anonymous/must-change-password/authenticated), never behind a login redirect.

## Key files

- `backend/books.service.ts` — all book/copy business logic, own dedicated `PrismaClient` (D57's pattern: never core's `PrismaService` directly).
- `backend/books.controller.ts` — the permission-gated CRUD surface above.
- `backend/public.controller.ts` — the one deliberate public route; read its docblock before adding another public endpoint anywhere in this module.
- `backend/platform.ts` — the local `@Public()`/`@RequirePermission()`/`@Audit()`/`@CurrentUser()`/`MustChangePasswordGuard` shims every module needs (D57) plus the one real cross-module import (`PublicThrottlerGuard` from `apps/api/dist/...`).
- `frontend/api.ts` — typed API client + `downloadBlob` helper (reused verbatim by `survey`'s own `api.ts`).
- `frontend/pages/ModerateReviewsPage.tsx` — the librarian's review-approval queue (LIBRARY_CATALOG-D21), reading `GET /books/ratings/pending` and calling approve/reject.
- `backend/settings.service.ts`/`backend/settings.controller.ts` — this module's first `system_settings`-backed value (`library_catalog.sticker_header_text`, LIBRARY_CATALOG-D22), same minimal per-module Settings pattern as `library_circulation`'s/`template`'s own `settings.service.ts` (root D70/D71).
- `frontend/pages/PrintCodesPage.tsx` — the filter/preview/print/export page (LIBRARY_CATALOG-D22).
- `frontend/pages/CopiesInventoryPage.tsx` — the Annual-inventory filter/table/export page (LIBRARY_CATALOG-D25), filtering by status/location/book-title rather than acquisition date.
- `frontend/pages/QrCodeImage.tsx` — client-side QR rendering, deliberately duplicated from `library_circulation`'s own component of the same name (see its own docblock for why — same A14/YAGNI reasoning, not a shared package yet).

## Known gotchas

- **This module intentionally does not track borrowing/returning/fines at all** — `library_catalog_book_copies.status` only reflects a copy's *current* state; there is no borrowing history table here. That's `library_circulation`/`library_finance`'s job (a single combined future module per root `D44`), which will `dependsOn: ["library_catalog"]`. Don't add borrowing fields to this module when that need comes up — add the new module instead.
  - **Exception**: Feature 2.1 (D18) adds a `history` JSONB column tracking changes to copy state (`status`, `condition`, `location`) — this is catalog-level metadata for audit/compliance, not circulation history. See DECISIONS.md D18 for the manual migration process.
- The `export` endpoint returns a raw `xlsx` buffer; Supertest/`superagent`-based e2e tests need an explicit binary `.parse()` callback to read it correctly (root `D63` — a real bug found in a *different* module's export endpoint with the exact same shape; if this module's own export test ever reads `.body` as `undefined`, that's why).

## How to extend

- **A new book field** (e.g. `edition`): add a migration (`003_...sql`, `ALTER TABLE ... ADD COLUMN`), mirror it in `apps/api/prisma/schema.prisma`'s `LibraryCatalogBook` model, add it to `CreateBookDto`/`UpdateBookDto` with real `class-validator` decorators (see root `D67` — an undecorated field is silently stripped by the global `ValidationPipe`), thread it through `BooksService`, and add the column to `BooksListPage.tsx`'s table + `BookFormDialog.tsx`'s form + both locale files.
- **A new copy status**: `ALTER TYPE library_catalog_book_copy_status ADD VALUE '...'` in a new migration file (append-only per D16 — never edit `002_...sql` in place).

## Migration Application (D18 / Platform D47)

The platform currently **does not auto-apply migrations on startup** (root D47). When features introduce new migrations (like D18's history column), you must apply them manually:

1. **Code already carries the migration**: `modules/library_catalog/migrations/003_add_copy_history.sql` exists.
2. **Prisma schema is already updated**: `apps/api/prisma/schema.prisma`'s `LibraryCatalogBookCopy` model includes `history Json @default("[]")`.
3. **You must apply the SQL manually**:
   ```bash
   # Using psql directly:
   psql $DATABASE_URL < modules/library_catalog/migrations/003_add_copy_history.sql
   
   # Or via Docker (if using docker-compose):
   docker-compose exec db psql -U postgres -d papp < modules/library_catalog/migrations/003_add_copy_history.sql
   ```
4. **Record the migration in the registry** (required so the platform knows not to re-apply it):
   ```bash
   # SQL to run against the same database:
   INSERT INTO module_migrations (id, module_key, filename, checksum)
   VALUES (gen_random_uuid(), 'library_catalog', '003_add_copy_history.sql', 
           ''); -- checksum is validated against the file; see MigrationRunnerService
   ```
   - The checksum must match what `MigrationRunnerService.computeChecksum()` calculates for the SQL file. Run the API and check logs if unsure.

**Future**: Once the platform supports automatic migration discovery/application on module install (root D47), this manual step will no longer be needed.

### Migration D20 — book ratings

`modules/library_catalog/migrations/004_create_book_ratings_table.sql` creates `library_catalog_book_ratings`. Apply the same way:

```bash
psql $DATABASE_URL -f modules/library_catalog/migrations/004_create_book_ratings_table.sql
```

Then register it (checksum is `sha256(file contents, utf8)`, matching `MigrationRunnerService.checksumOf`):

```sql
INSERT INTO module_migrations (module_key, filename, checksum)
VALUES ('library_catalog', '004_create_book_ratings_table.sql', 'e8439b0de876b4964dde0a8c6985d0a24f1b9986939bbe175fe5f4905f3339a8');
```

`apps/api/prisma/schema.prisma`'s `LibraryCatalogBookRating` model is already hand-maintained to match — re-run `npx prisma generate` (never `migrate`) after pulling this change.

### Migration D21 — review moderation

`modules/library_catalog/migrations/005_add_review_moderation.sql` adds `review_status`/`moderated_by`/`moderated_at` to `library_catalog_book_ratings`. Apply the same way:

```bash
psql $DATABASE_URL -f modules/library_catalog/migrations/005_add_review_moderation.sql
```

Then register it:

```sql
INSERT INTO module_migrations (module_key, filename, checksum)
VALUES ('library_catalog', '005_add_review_moderation.sql', '7a77e8cd8f3c950518490a02a0a22694da748eb3392da1395c69558c3cbc4348');
```

`apps/api/prisma/schema.prisma`'s `LibraryCatalogBookRating` model already has the three new fields — re-run `npx prisma generate` after pulling this change.

### Migration D22 — copy-code sequence

`modules/library_catalog/migrations/006_add_copy_code_sequence.sql` adds the Postgres `SEQUENCE` `library_catalog_copy_code_seq` (no table/column change — nothing to add to `schema.prisma`, `BooksService.nextCopyCode()` calls it via a raw `$queryRawUnsafe('SELECT nextval(...)')`, same pattern as `library_circulation`'s `FinesService.nextNumber()`). Apply the same way:

```bash
psql $DATABASE_URL -f modules/library_catalog/migrations/006_add_copy_code_sequence.sql
```

Then register it:

```sql
INSERT INTO module_migrations (module_key, filename, checksum)
VALUES ('library_catalog', '006_add_copy_code_sequence.sql', 'f91477d73e18596db90ed92045fe66d3b11837cfd42fd19c9f3c274ed3d4c600');
```

No `prisma generate` needed — a bare `SEQUENCE` has no Prisma model.

### Migration D24 — book page count

`modules/library_catalog/migrations/007_add_page_count.sql` adds `page_count INTEGER CHECK (page_count > 0)` to `library_catalog_books`. Apply the same way:

```bash
psql $DATABASE_URL -f modules/library_catalog/migrations/007_add_page_count.sql
```

Then register it:

```sql
INSERT INTO module_migrations (module_key, filename, checksum)
VALUES ('library_catalog', '007_add_page_count.sql', '1d5a66c77d4d2ccda4ef3c3036b5cddbb5a1d2926376fc69eac4d1540107a9f5');
```

`apps/api/prisma/schema.prisma`'s `LibraryCatalogBook` model already has the new `pageCount Int?` field — re-run `npx prisma generate` after pulling this change. See `modules/reading_club/DOCUMENTATION.md`'s own migration-application section (READING_CLUB-D18) for the matching `reading_club` migration that consumes this field.

### Down migrations (root D48 / D86)

`migrations/down/001_create_books_table.sql`, `down/002_create_book_copies_table.sql`, `down/003_add_copy_history.sql` now exist — the structural inverse of each up-migration of the same number, applied in descending filename order (`003` → `002` → `001`) by `ModuleRegistryService.runDownMigrationsIfPresent` when an admin uninstalls this module with `--drop-data`. `003`'s down drops the `history` column/GIN index it added; `002`'s down drops `library_catalog_book_copies` and its ENUM type; `001`'s down drops `library_catalog_books`. Before this, `--drop-data` on this module silently left every table in place (no `migrations/down/` existed at all) — see root D86 for the platform-level fix (a dependency guard was added alongside this so uninstalling this module while `library_circulation` still depends on it is now rejected, not just a docs warning).

`down/007_add_page_count.sql` (LIBRARY_CATALOG-D24) was added alongside its up-migration — drops the `page_count` column.

**Known gap**: migrations `004_create_book_ratings_table.sql`/`005_add_review_moderation.sql`/`006_add_copy_code_sequence.sql` (added after D86's down-migrations were written) have **no** `down/004_...`/`down/005_...`/`down/006_...` counterpart yet — `--drop-data` uninstall on this module today only reverts through `003`, then (once it hits 007, which DOES have a down) would still fail partway on the 004-006 gap. Flagged here rather than silently worked around; needs the same treatment D86 gave 001-003 (006 in particular needs `DROP SEQUENCE IF EXISTS library_catalog_copy_code_seq`, not a column drop).

`down/006_add_copy_code_sequence.sql` (LIBRARY_CATALOG-D22) DOES exist (`DROP SEQUENCE IF EXISTS`) — but since the numbering gap at 004/005 above already breaks the descending-order `runDownMigrationsIfPresent` sweep before it would ever reach 006, this is latent until 004/005's down-migrations are written.
