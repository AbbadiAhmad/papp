# Library Catalog module — documentation

Read `docs/MODULE_SPEC.md` §9 for what this file and `DECISIONS.md` are for and when to update them. Read `DECISIONS.md` in this same directory too — this file is the current shape, that one is why it's shaped that way.

## Purpose

Book catalog: titles and their individually-tracked physical copies (by QR code), with categories/authors/reading level, plus one public shareable link so anyone can check a specific copy's availability without logging in. Borrowing/returning/fines are **deliberately out of scope** — see Known gotchas.

## Data model

```
library_catalog_books(
  id, title, author, publisher, category, reading_level, language,
  description, cover_image, created_at, updated_at
)
library_catalog_book_copies(
  id, book_id -> books(id) ON DELETE CASCADE,
  qr_code UNIQUE, status ENUM(available|borrowed|lost|damaged|maintenance|reserved),
  condition, location, acquisition_date, created_at, updated_at,
  history JSONB[] DEFAULT '[]'
)
library_catalog_book_ratings(
  id, book_id -> books(id) ON DELETE CASCADE, user_id -> users(id),
  rating SMALLINT CHECK(1-5), review TEXT NULL, created_at, updated_at,
  UNIQUE(book_id, user_id)
)
```

- `status` is a real Postgres `ENUM` (`library_catalog_book_copy_status`), not a `TEXT` + `CHECK` — required for Prisma's `enum` mapping (see the migration's own comment; the same lesson core's `0000`/`0005` migrations already learned).
- Deleting a book **cascades** to its copies — a copy cannot outlive its title. A future circulation module deciding to block that delete when a copy has borrowing history is that module's job, not this one's (see Known gotchas).
- `updated_at` exists on both tables specifically so `@Audit`'s before/after diff on an `update` has more than just the one changed field to show.
- `history` (Feature 2.1 — D18) is a JSONB array tracking up to 100 most recent changes to `status`, `condition`, and `location`. Each entry records `{ timestamp, changes: { field: { before, after } } }`. The `getCopyHistory` endpoint retrieves these entries. See DECISIONS.md D18 for the migration application process.
- `library_catalog_book_ratings` (LIBRARY_CATALOG-D20) is one row per (book, user) — `UNIQUE(book_id, user_id)`, `rating` a plain `SMALLINT` + `CHECK` (not a Prisma `enum` — no need for one, unlike copy `status`), `review` optional free text. `user_id` is a plain scalar column with no Prisma relation to the core `User` model; the rater's display name is joined in `BooksService` via a separate `prisma.user.findMany` call, not a Prisma `include`. Re-rating UPSERTs the same row — there is never a second rating row for the same reader/book pair. Deleting a book cascades to its ratings (`ON DELETE CASCADE`, same as copies).

## Permissions

| Code | Gates | Checked in |
|---|---|---|
| `library_catalog.books.view` | List/get a book, list a book's copies | `BooksController.list/findById/listCopies` |
| `library_catalog.books.create` | Create a book, add a copy to a book | `BooksController.create/addCopy` |
| `library_catalog.books.update` | Edit a book, update a copy's status/condition/location | `BooksController.update/updateCopy` |
| `library_catalog.books.delete` | Delete a book (and, via cascade, its copies), or remove a single copy directly | `BooksController.remove/removeCopy` |
| `library_catalog.books.export` | Download the books list as `.xlsx` | `BooksController.export` |
| `library_catalog.books.rate` | Create/update/delete the CALLER'S OWN rating+review for a book (never someone else's) | `BooksController.rateBook/removeRating` |

`defaultRolePermissions`: `admin` gets all 6; `library_assistant` gets view/create/update/rate (no delete/export); `finance` gets none; `reader` gets view+rate. The public availability route (below) needs no permission at all — there is no user to check one against. `books.rate` is intentionally NOT hardcoded to any one role — see DECISIONS.md D20: whoever holds it can rate, matching every other permission-gated action on this platform.

## Routes

Backend (`apiPrefix: /api/library`):
- `GET/POST /books`, `GET/PATCH/DELETE /books/:id`, `GET /books/export` — `BooksController`, all `@RequirePermission`-gated as above.
- `GET/POST /books/:bookId/copies`, `PATCH/DELETE /books/:bookId/copies/:id` — same controller, copies sub-resource. `DELETE` is gated by `books.delete` (not a separate code, matching the sub-resource pattern), and fails with 409 if the copy has `library_circulation` borrowing history (no `ON DELETE CASCADE` on that FK — see LIBRARY_CATALOG-D8).
- `GET /public/books/:id/availability` — `PublicBooksController`, `@Public()` + `PublicThrottlerGuard` (D34 — even though it's a read, applied "for consistency" per the module's own build notes) + `@Audit(...)` (deliberately, to exercise the `actor_type='anonymous'` audit path — see that controller's own docblock).
- `PUT/DELETE /books/:bookId/rating` — `BooksController`, `books.rate`-gated, always the CALLER's own rating (`@CurrentUser()`, never a `:userId` param). `GET /books/:id` (`findById`) already returns the full ratings list + live average + the caller's own `myRating` — there is no separate `GET .../ratings` list route.

Frontend (`basePath: /library`):
- `/library/books` (authenticated, `books.view`) → `BooksListPage.tsx`
- `/library/books/:bookId` (authenticated, `books.view`) → `BookDetailPage.tsx`
- `/library/public/books/:bookId/availability` (**public**) → `PublicBookAvailabilityPage.tsx` — mounted in every `AppRoutes` branch (anonymous/must-change-password/authenticated), never behind a login redirect.

## Key files

- `backend/books.service.ts` — all book/copy business logic, own dedicated `PrismaClient` (D57's pattern: never core's `PrismaService` directly).
- `backend/books.controller.ts` — the permission-gated CRUD surface above.
- `backend/public.controller.ts` — the one deliberate public route; read its docblock before adding another public endpoint anywhere in this module.
- `backend/platform.ts` — the local `@Public()`/`@RequirePermission()`/`@Audit()`/`@CurrentUser()`/`MustChangePasswordGuard` shims every module needs (D57) plus the one real cross-module import (`PublicThrottlerGuard` from `apps/api/dist/...`).
- `frontend/api.ts` — typed API client + `downloadBlob` helper (reused verbatim by `survey`'s own `api.ts`).

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
