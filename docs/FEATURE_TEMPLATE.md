# Feature Page Template & Permission Wiring

**Status: this template is now backed by a real, buildable module** — `modules/library_catalog/` (built in Phase 8) is the actual worked example below, not pseudocode. Where this document and the real code ever disagree, the real code wins; if you find a mismatch, fix this doc rather than trusting stale prose (this file itself was corrected once already, in Phase 8, after drifting from the platform's real i18n/permission-gating conventions — see `docs/DECISIONS.md` D55-D57 for the packaging constraints that update covered).

Worked example: **"Books" list/create/edit page inside the `library_catalog` module.**

## 0. Packaging constraints (read `MODULE_SPEC.md` §1 first)

A module's directory is snake_case and equals its manifest `key` exactly (`modules/library_catalog/`, not hyphenated). `backend.entry` points to **compiled JS**, never raw `.ts` — the module ships its own `tsconfig.json` compiling `backend/*.ts` → `backend/*.js` in place, with both checked into git. Because a dynamically-loaded module can't import `apps/api/src/common/**` directly, it ships a small local `backend/platform.ts` re-declaring `@Public()`/`@RequirePermission()`/`@Audit()`/`@CurrentUser()`/`MustChangePasswordGuard` as thin shims against the **exact same literal metadata key strings** core's real global guards read (`isPublic`, `requiredPermission`, `auditMetadata`, `allowMustChangePassword`) — copy `modules/library_catalog/backend/platform.ts` as your starting point, don't reinvent it, and double-check the key strings against the real files in `apps/api/src/common/decorators/` if you're ever unsure (a silent string mismatch there is not caught by the compiler). `PublicThrottlerGuard` is the one guard modules import for real, from `apps/api/dist/...`.

## 1. Backend: permission-gated controller

```ts
// modules/library_catalog/backend/books.controller.ts
import { Public, RequirePermission, Audit, CurrentUser, AuthenticatedUser, MustChangePasswordGuard } from './platform';

@Controller('books')                        // mounted under the module's apiPrefix, e.g. /api/library/books
@UseGuards(MustChangePasswordGuard)          // the ONE guard a module still applies locally — JwtAuthGuard/PermissionGuard
export class BooksController {              // are GLOBAL (app.module.ts APP_GUARD) and already cover every controller,
  constructor(private readonly books: BooksService) {}   // including dynamically-mounted module controllers, automatically.

  @Get()
  @RequirePermission('library_catalog.books.view')
  async list(@Query() query: ListBooksDto) {
    return this.books.list(query);
  }

  @Post()
  @RequirePermission('library_catalog.books.create')
  @Audit({ category: 'library_catalog', entityType: 'Book', action: 'create' })
  async create(@Body() dto: CreateBookDto, @CurrentUser() user: AuthenticatedUser) {
    return this.books.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission('library_catalog.books.update')
  @Audit({ category: 'library_catalog', entityType: 'Book', action: 'update', entityIdParam: 'id',
           fetchState: (prisma, req) => prisma.libraryCatalogBook.findUnique({ where: { id: req.params.id } }) })
  async update(@Param('id') id: string, @Body() dto: UpdateBookDto) {
    return this.books.update(id, dto);   // AuditInterceptor diffs the fetchState before/after snapshots automatically
  }

  @Delete(':id')
  @RequirePermission('library_catalog.books.delete')
  @Audit({ category: 'library_catalog', entityType: 'Book', action: 'delete' })
  async remove(@Param('id') id: string) {
    return this.books.remove(id);   // reject with 409 if the book has copies — never silently cascade-delete history
  }
}
```

```ts
// modules/library_catalog/backend/public.controller.ts — the one deliberate public route
@Controller('public/books')
export class PublicBooksController {
  constructor(private readonly books: BooksService) {}

  @Get(':id/availability')
  @Public()                                   // no login required — RBAC doesn't apply, this is intentional
  @UseGuards(PublicThrottlerGuard)             // required on any public WRITE endpoint; applied here too for consistency
  @Audit({ category: 'library_catalog.public', entityType: 'Book', action: 'view_availability' })
  async availability(@Param('id') id: string) {
    return this.books.getAvailability(id);    // service returns 404 for an unknown id — never a raw permission error
  }
}
```

Rules this demonstrates (non-negotiable, see SKILL.md):
- `@RequirePermission(code)` — the code must already exist in that module's `manifest.json` `permissions` array, and the code string uses no wildcards (`PermissionGuard` does exact `Set.has()` matching — every action gets its own explicit code, e.g. `library_catalog.books.view`/`.create`/`.update`/`.delete`/`.export`, never `library_catalog.books.*`). A code used in a controller but not declared in the manifest fails `scripts/lint-permissions.ts` (currently scoped to `apps/api/src/**` only — see that script's own TODO for extending it to `modules/*/manifest.json` cross-checks).
- `@Audit(...)` on every mutating endpoint. Read endpoints are not audited by default unless they return sensitive data or — as with the public availability route above — proving the anonymous-actor audit mechanism is specifically the point.
- No manual `if (user.role === 'admin')` anywhere in feature code, core or module. The **only** file in the whole codebase allowed that pattern is `apps/api/src/core/permissions/permissions-page.guard.ts` (`ARCHITECTURE.md` §7.4/§7.5, D12).
- `JwtAuthGuard`/`PermissionGuard` need no `@UseGuards` anywhere — they're global. Only `MustChangePasswordGuard` (deliberately not global — see its own docblock) needs applying per controller.

## 2. Frontend: page component

```tsx
// modules/library_catalog/frontend/pages/BooksListPage.tsx
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useGatedCall, Can } from '../../../../apps/web/src/shared/permissions';

export default function BooksListPage() {
  const { t } = useTranslation();                       // flat, single 'translation' namespace — see §4, NOT per-module
  const { data, status } = useGuardedQuery('library_catalog.books.view', () => booksApi.list());
  const createBook = useGatedCall('library_catalog.books.create', booksApi.create);

  if (status === 'forbidden') return <Navigate to="/forbidden" />;

  return (
    <PageLayout title={t('library_catalog.menu.books')}>
      <Can permission="library_catalog.books.create">
        <Button startIcon={<AddIcon />} onClick={() => createBook(newBookDraft)}>
          {t('library_catalog.actions.addBook')}
        </Button>
      </Can>
      <DataGrid
        rows={data ?? []}
        loading={status === 'loading'}
        columns={[
          { field: 'title', headerName: t('library_catalog.fields.title'), flex: 1 },
          { field: 'isbn', headerName: t('library_catalog.fields.isbn') },
          { field: 'createdAt', headerName: t('library_catalog.fields.createdAt'), valueFormatter: formatDate },
        ]}
      />
    </PageLayout>
  );
}
```

Rules this demonstrates — **corrected in Phase 8 from this doc's original illustration, which predated the real implementation:**
- **No `usePermission(code)` boolean hook exists.** There is no `GET /permissions/me/effective` endpoint (a documented, deliberate gap — `DECISIONS.md` A22), so gating is **outcome-based**: `useGuardedQuery`/`useGatedCall` make the real API call and learn deniability only from an actual 403. `<Can permission="...">` reflects that same real, reported outcome — never a precomputed/guessed permission set. A control stays visible until it's actually been denied once; the backend remains the real boundary regardless of what's shown. See `apps/web/src/shared/permissions.tsx`'s own docblock for the full rationale.
- Layout uses `PageLayout`/MUI components (inherit RTL automatically); no manual `margin-left`/`text-align: left` — logical CSS properties only if any custom style is unavoidable.
- Dates/numbers go through the shared `formatDate`/`formatNumber` utilities (pinned Gregorian calendar + Latin digits, D6/D7), never raw `toLocaleDateString()` calls.

## 3. Manifest wiring (excerpt — full file in MODULE_SPEC.md)

```jsonc
{
  "permissions": [
    { "code": "library_catalog.books.view", "category": "library_catalog", "descriptionKey": "library_catalog.perm.books.view" },
    { "code": "library_catalog.books.create", "category": "library_catalog", "descriptionKey": "library_catalog.perm.books.create" }
    // ...update/delete/export as needed — one explicit code per action, no wildcards
  ],
  "defaultRolePermissions": {
    "admin": ["library_catalog.books.view", "library_catalog.books.create", "..."],
    "library_assistant": ["library_catalog.books.view", "library_catalog.books.create"],
    "finance": [],
    "reader": ["library_catalog.books.view"]
  },
  "routes": [
    { "pattern": "/library/public/books/:id/availability", "access": "public", "component": "frontend/pages/PublicBookAvailabilityPage.tsx" }
  ],
  "menu": [
    { "id": "library_catalog.books.list", "labelKey": "library_catalog.menu.books", "route": "/library/books", "requiredPermission": "library_catalog.books.view", "parentId": "library_catalog.root", "order": 1 }
  ]
}
```

## 4. Locale files — **flat, dot-namespaced keys, not nested objects**

**Corrected in Phase 8**: the real `I18nService` (`apps/api/src/core/i18n/i18n.service.ts`) reads locale files as a **flat single `translation` namespace** and silently **drops any nested-object value**, keeping only top-level string values. This doc originally illustrated nested JSON (`{"menu": {"books": "..."}}`) and a per-module `useTranslation('library_catalog')` namespace — neither matches the real merge behavior. Use flat, dot-prefixed keys exactly like `apps/api/src/core/i18n/locales/*.json` does:

```json
// modules/library_catalog/locales/ar.json
{
  "library_catalog.menu.root": "المكتبة",
  "library_catalog.menu.books": "الكتب",
  "library_catalog.fields.title": "العنوان",
  "library_catalog.fields.isbn": "الترقيم الدولي",
  "library_catalog.fields.createdAt": "تاريخ الإضافة",
  "library_catalog.actions.addBook": "إضافة كتاب",
  "library_catalog.perm.books.view": "عرض الكتب",
  "library_catalog.perm.books.create": "إضافة كتب"
}
```

```json
// modules/library_catalog/locales/en.json
{
  "library_catalog.menu.root": "Library",
  "library_catalog.menu.books": "Books",
  "library_catalog.fields.title": "Title",
  "library_catalog.fields.isbn": "ISBN",
  "library_catalog.fields.createdAt": "Added on",
  "library_catalog.actions.addBook": "Add Book",
  "library_catalog.perm.books.view": "View books",
  "library_catalog.perm.books.create": "Create books"
}
```

`scripts/lint-locales.ts` checks `ar.json`/`en.json` key sets match exactly for every module found under `modules/*/locales/` — run `npm run lint:locales` after adding yours.

## 5. Migration file

```sql
-- modules/library_catalog/migrations/001_create_books_table.sql
CREATE TABLE library_catalog_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  isbn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES users(id)
);
```

Table name prefixed with the module key (`library_catalog_`) — avoids cross-module collisions without needing separate Postgres schemas. Include `updated_at` on any table `@Audit`'ed updates will diff — needed for a real before/after comparison.

## 6. Tests expected alongside this feature

Per the tiered testing policy (`docs/TESTING_STRATEGY.md` §0, D37) — **Tier 1 only** while the base platform/its modules are still being built; Tier 2 (real e2e, the full permission-matrix sweep, Playwright) is deferred to the dedicated hardening phase:
- Backend unit test: `BooksService` business logic, mocked Prisma — no real DB.
- Backend audit test (Tier 1, mocked): the `@Audit` `fetchState` callback shape and redaction behavior, not a live DB diff.
- Frontend test: the page renders its gated action only after a real (mocked) API call succeeds/is denied — matching the outcome-based pattern in §2, not a precomputed boolean.
- Manifest lint: `npm run lint:permissions`/`lint:locales`/`lint:no-hardcoded-roles` all clean.
- Deferred to the hardening phase: full permission-matrix e2e per role, the real public-route throttling/anonymous-audit proof against a live app+DB (already manually verified once during this module's initial build — see its Developer report — but not yet a committed automated Tier 2 test).
