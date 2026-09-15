# Feature Page Template & Permission Wiring

A worked, illustrative example — **pseudocode/reference, not yet a buildable repo** — showing exactly how a new page/feature must be built so every feature is consistent. This is the pattern `.claude/skills/papp-add-feature/SKILL.md` enforces for anything built on this platform, whether it's core (e.g. Users) or a module (e.g. Library Catalog's Books).

Worked example: **"Books" list/create/edit page inside the `library_catalog` module.**

## 1. Backend: permission-gated controller

```ts
// modules/library-catalog/backend/books.controller.ts

@Controller('library/books')
@UseGuards(JwtAuthGuard, PermissionGuard)   // every controller in the platform gets both, no exceptions
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Get()
  @RequirePermission('library_catalog.books.view')
  async list(@Query() query: ListBooksDto) {
    return this.books.list(query);
  }

  @Post()
  @RequirePermission('library_catalog.books.create')
  @Audit({ category: 'library_catalog', entityType: 'Book', action: 'create' })
  async create(@Body() dto: CreateBookDto, @CurrentUser() user: AuthUser) {
    return this.books.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission('library_catalog.books.update')
  @Audit({ category: 'library_catalog', entityType: 'Book', action: 'update' })
  async update(@Param('id') id: string, @Body() dto: UpdateBookDto) {
    return this.books.update(id, dto);   // AuditInterceptor diffs return value vs pre-fetched entity automatically
  }

  @Delete(':id')
  @RequirePermission('library_catalog.books.delete')
  @Audit({ category: 'library_catalog', entityType: 'Book', action: 'delete' })
  async remove(@Param('id') id: string) {
    return this.books.remove(id);
  }
}
```

Rules this demonstrates (non-negotiable, see SKILL.md):
- `@RequirePermission(code)` — the code must already exist in that module's `manifest.json` `permissions` array. A permission code used in a controller but not declared in the manifest fails a CI lint check (`scripts/lint-permissions.ts`, to be written alongside real code).
- `@Audit(...)` on every mutating endpoint. Read endpoints (`@Get`) are not audited (too noisy) unless they return sensitive data (e.g. viewing another user's session list) — those get `@Audit(..., action: 'view_sensitive')`.
- No manual `if (user.role === 'admin')` anywhere in feature code. The **only** file in the whole codebase allowed that pattern is the Permissions page's guard (`ARCHITECTURE.md` §7.4).

## 2. Frontend: page component

```tsx
// modules/library-catalog/frontend/pages/BooksListPage.tsx

export default function BooksListPage() {
  const { t } = useTranslation('library_catalog');   // module-namespaced i18n, per D19
  const canCreate = usePermission('library_catalog.books.create');
  const canDelete = usePermission('library_catalog.books.delete');
  const { data, isLoading } = useBooksQuery();

  return (
    <PageLayout title={t('menu.books')}>
      {canCreate && (
        <Button startIcon={<AddIcon />} onClick={openCreateDialog}>
          {t('actions.addBook')}
        </Button>
      )}
      <DataGrid
        rows={data ?? []}
        loading={isLoading}
        columns={[
          { field: 'title', headerName: t('fields.title'), flex: 1 },
          { field: 'isbn', headerName: t('fields.isbn') },
          { field: 'createdAt', headerName: t('fields.createdAt'), valueFormatter: formatDate },  // formatDate pins Gregorian + Latin digits, D6/D7
          ...(canDelete ? [{ field: 'actions', renderCell: DeleteAction }] : []),
        ]}
      />
    </PageLayout>
  );
}
```

Rules this demonstrates:
- `usePermission(code)` gates rendering of anything the backend would reject — this is UX only, never the security boundary (backend guard already enforces it).
- All copy goes through `t('key')` against the module's own namespace — no hardcoded English/Arabic strings in JSX.
- Layout uses `PageLayout`/MUI components (inherit RTL automatically); no manual `margin-left`/`text-align: left` — logical CSS properties only if any custom style is unavoidable.
- Dates/numbers go through the shared `formatDate`/`formatNumber` utilities (pinned Gregorian calendar + Latin digits), never raw `toLocaleDateString()` calls scattered around.

## 3. Manifest wiring (excerpt — full file in MODULE_SPEC.md)

```jsonc
{
  "permissions": [
    { "code": "library_catalog.books.view", "category": "library_catalog", "descriptionKey": "library_catalog.perm.books.view" },
    { "code": "library_catalog.books.create", "category": "library_catalog", "descriptionKey": "library_catalog.perm.books.create" }
    // ...update/delete/export as needed
  ],
  "defaultRolePermissions": {
    "admin": ["library_catalog.books.view", "library_catalog.books.create", "..."],
    "library_assistant": ["library_catalog.books.view", "library_catalog.books.create"],
    "finance": [],
    "reader": ["library_catalog.books.view"]
  },
  "menu": [
    { "id": "library_catalog.books.list", "labelKey": "library_catalog.menu.books", "route": "/library/books", "requiredPermission": "library_catalog.books.view", "parentId": "library_catalog.root", "order": 1 }
  ]
}
```

## 4. Locale files (per D19, one per supported language, module-namespaced)

```json
// modules/library-catalog/locales/ar.json
{
  "menu": { "root": "المكتبة", "books": "الكتب" },
  "fields": { "title": "العنوان", "isbn": "الترقيم الدولي", "createdAt": "تاريخ الإضافة" },
  "actions": { "addBook": "إضافة كتاب" },
  "perm": { "books": { "view": "عرض الكتب", "create": "إضافة كتب" } }
}
```

```json
// modules/library-catalog/locales/en.json
{
  "menu": { "root": "Library", "books": "Books" },
  "fields": { "title": "Title", "isbn": "ISBN", "createdAt": "Added on" },
  "actions": { "addBook": "Add Book" },
  "perm": { "books": { "view": "View books", "create": "Create books" } }
}
```

## 5. Migration file

```sql
-- modules/library-catalog/migrations/001_create_books_table.sql
CREATE TABLE library_catalog_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  isbn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES users(id)
);
```

Table name prefixed with the module key (`library_catalog_`) — avoids cross-module collisions without needing separate Postgres schemas.

## 6. Tests expected alongside this feature

See `docs/TESTING_STRATEGY.md` for the full pattern; at minimum:
- Backend unit test: `BooksService` business logic.
- Backend e2e test: each endpoint, asserting 200/201 for a role with the permission and 403 for one without — using the shared permission-matrix test helper.
- Backend audit test: creating/updating/deleting a book produces the expected `audit_log` row with correct old/new values.
- Frontend test: `BooksListPage` renders the "Add Book" button only when `usePermission` returns true (mocked).
- Manifest lint: permission codes referenced in controllers/menu all exist in `manifest.json`; `ar` locale file has no missing keys vs `en`.
