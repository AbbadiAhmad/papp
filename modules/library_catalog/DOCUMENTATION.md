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
  condition, location, acquisition_date, created_at, updated_at
)
```

- `status` is a real Postgres `ENUM` (`library_catalog_book_copy_status`), not a `TEXT` + `CHECK` — required for Prisma's `enum` mapping (see the migration's own comment; the same lesson core's `0000`/`0005` migrations already learned).
- Deleting a book **cascades** to its copies — a copy cannot outlive its title. A future circulation module deciding to block that delete when a copy has borrowing history is that module's job, not this one's (see Known gotchas).
- `updated_at` exists on both tables specifically so `@Audit`'s before/after diff on an `update` has more than just the one changed field to show.

## Permissions

| Code | Gates | Checked in |
|---|---|---|
| `library_catalog.books.view` | List/get a book, list a book's copies | `BooksController.list/findById/listCopies` |
| `library_catalog.books.create` | Create a book, add a copy to a book | `BooksController.create/addCopy` |
| `library_catalog.books.update` | Edit a book, update a copy's status/condition/location | `BooksController.update/updateCopy` |
| `library_catalog.books.delete` | Delete a book (and, via cascade, its copies) | `BooksController.remove` |
| `library_catalog.books.export` | Download the books list as `.xlsx` | `BooksController.export` |

`defaultRolePermissions`: `admin` gets all 5; `library_assistant` gets view/create/update (no delete/export); `finance` gets none; `reader` gets view only. The public availability route (below) needs no permission at all — there is no user to check one against.

## Routes

Backend (`apiPrefix: /api/library`):
- `GET/POST /books`, `GET/PATCH/DELETE /books/:id`, `GET /books/export` — `BooksController`, all `@RequirePermission`-gated as above.
- `GET/POST /books/:bookId/copies`, `PATCH /books/:bookId/copies/:id` — same controller, copies sub-resource.
- `GET /public/books/:id/availability` — `PublicBooksController`, `@Public()` + `PublicThrottlerGuard` (D34 — even though it's a read, applied "for consistency" per the module's own build notes) + `@Audit(...)` (deliberately, to exercise the `actor_type='anonymous'` audit path — see that controller's own docblock).

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

- **This module intentionally does not track borrowing/returning/fines at all** — `library_catalog_book_copies.status` only reflects a copy's *current* state; there is no history table here. That's `library_circulation`/`library_finance`'s job (a single combined future module per root `D44`), which will `dependsOn: ["library_catalog"]`. Don't add borrowing fields to this module when that need comes up — add the new module instead.
- The `export` endpoint returns a raw `xlsx` buffer; Supertest/`superagent`-based e2e tests need an explicit binary `.parse()` callback to read it correctly (root `D63` — a real bug found in a *different* module's export endpoint with the exact same shape; if this module's own export test ever reads `.body` as `undefined`, that's why).

## How to extend

- **A new book field** (e.g. `edition`): add a migration (`003_...sql`, `ALTER TABLE ... ADD COLUMN`), mirror it in `apps/api/prisma/schema.prisma`'s `LibraryCatalogBook` model, add it to `CreateBookDto`/`UpdateBookDto` with real `class-validator` decorators (see root `D67` — an undecorated field is silently stripped by the global `ValidationPipe`), thread it through `BooksService`, and add the column to `BooksListPage.tsx`'s table + `BookFormDialog.tsx`'s form + both locale files.
- **A new copy status**: `ALTER TYPE library_catalog_book_copy_status ADD VALUE '...'` in a new migration file (append-only per D16 — never edit `002_...sql` in place).
