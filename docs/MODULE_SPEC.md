# Module Manifest Spec

How a feature (Library Catalog, Borrowing, Finance, …) plugs into the base platform. Modeled on Odoo/Gibbon's module manifests, adapted for the "dynamic install, orchestrated restart" strategy agreed in `docs/DECISIONS.md` (D15).

## 1. Package layout

```
modules/library-catalog/
├── manifest.json
├── migrations/
│   ├── 001_create_books_table.sql
│   ├── 002_add_isbn_index.sql
│   └── ...
├── backend/
│   ├── library-catalog.module.ts      -- NestJS module, imported by the registry loader
│   ├── books.controller.ts
│   ├── books.service.ts
│   └── ...
├── frontend/
│   ├── routes.tsx                      -- lazy-loaded route tree, mounted under the module's base path
│   ├── pages/
│   │   └── BooksListPage.tsx
│   └── ...
└── locales/
    ├── ar.json
    └── en.json
```

## 2. `manifest.json` schema

```jsonc
{
  "key": "library_catalog",                 // unique, immutable, snake_case — used as DB category prefix, permission prefix, i18n namespace
  "name": "Library Catalog",                 // human name (fallback if no i18n key resolves)
  "version": "1.0.0",                        // semver
  "compatibleAppVersion": ">=0.1.0 <1.0.0",   // semver range against the base platform's own version
  "dependsOn": [],                            // other module keys this one requires installed first, e.g. ["core"]
  "description": "Book catalog: titles, copies, authors, categories.",

  "migrations": {
    "dir": "migrations",                      // applied in filename order, tracked in module_migrations table, checksum-verified (no silent edits to an applied file)
  },

  "locales": {
    "supported": ["ar", "en"],                // must include the platform default language (ar) or install is rejected
    "dir": "locales"
  },

  "permissions": [
    {
      "code": "library_catalog.books.view",
      "category": "library_catalog",
      "descriptionKey": "library_catalog.perm.books.view"
    },
    { "code": "library_catalog.books.create", "category": "library_catalog", "descriptionKey": "library_catalog.perm.books.create" },
    { "code": "library_catalog.books.update", "category": "library_catalog", "descriptionKey": "library_catalog.perm.books.update" },
    { "code": "library_catalog.books.delete", "category": "library_catalog", "descriptionKey": "library_catalog.perm.books.delete" },
    { "code": "library_catalog.books.export", "category": "library_catalog", "descriptionKey": "library_catalog.perm.books.export" }
  ],

  "defaultRolePermissions": {
    // Applied once, at install time only. Admins can change grants afterward from the Permissions page;
    // re-installing/upgrading never re-applies this (would silently overwrite an admin's deliberate changes).
    "admin": ["library_catalog.books.view", "library_catalog.books.create", "library_catalog.books.update", "library_catalog.books.delete", "library_catalog.books.export"],
    "library_assistant": ["library_catalog.books.view", "library_catalog.books.create", "library_catalog.books.update"],
    "finance": [],
    "reader": ["library_catalog.books.view"]
  },

  "roleAccessPolicy": "grantable",   // "grantable" = any role's grants can be edited by admin later;
                                       // "locked" = this module's permissions can never be granted to this role at all
                                       // (e.g. a future "readers can never see Finance module" hard rule) — per-role, see below
  "roleAccessLocked": {
    // roles explicitly forbidden from ever being granted this module's permissions, even by an admin.
    // Empty by default. Use sparingly — this is a stronger statement than "not granted by default."
  },

  "menu": [
    {
      "id": "library_catalog.root",
      "labelKey": "library_catalog.menu.root",
      "icon": "MenuBook",
      "parentId": null,                       // top-level menu entry; use another entry's id to nest under it
      "order": 20,
      "route": "/library/books",
      "requiredPermission": "library_catalog.books.view"
    },
    {
      "id": "library_catalog.books.list",
      "labelKey": "library_catalog.menu.books",
      "parentId": "library_catalog.root",
      "order": 1,
      "route": "/library/books",
      "requiredPermission": "library_catalog.books.view"
    }
  ],

  "routes": [
    // Every frontend route the module owns, not just the ones in "menu" — includes detail pages,
    // and any route meant to be reached by a direct/shared link rather than site navigation.
    // See §7 "Public / shareable routes" for the "public" access level.
    {
      "pattern": "/library/books/:bookId",
      "access": "authenticated",              // default if omitted
      "requiredPermission": "library_catalog.books.view",
      "component": "frontend/pages/BookDetailPage.tsx"
    }
  ],

  "frontend": {
    "basePath": "/library",                   // route prefix this module owns; install-time collision check against other installed modules — every entry in "menu" and "routes" must fall under this prefix
    "entry": "frontend/routes.tsx",
    "landingPage": "/library/books"            // where "open module" / its top menu entry lands
  },

  "backend": {
    "entry": "backend/library-catalog.module.ts",
    "apiPrefix": "/api/library"                // collision-checked the same way as basePath
  },

  "lifecycle": {
    "onInstall": null,                          // optional path to a one-off TS script for seed data etc. (rare — prefer migrations)
    "onUpgrade": null,                          // receives {fromVersion, toVersion}; for data backfills that aren't plain SQL
    "onUninstall": null                         // optional cleanup hook; migrations are NOT auto-reverted on uninstall (see §5)
  }
}
```

## 3. `module_registry` (core DB table)

```
module_registry(
  key, version, status,       -- status: installing | installed | upgrading | disabled | uninstalling | failed
  installed_at, updated_at,
  manifest_snapshot jsonb      -- the manifest as it was at install/upgrade time, for audit/debugging
)
module_migrations(
  module_key, filename, checksum, applied_at
)
```

`status = disabled` implements the "Hybrid" idea from the original options even though we're on dynamic install: an installed module can be turned off (menus/routes hidden, permission checks on its endpoints short-circuit to 403) without uninstalling — cheaper than a full uninstall/reinstall cycle for temporarily hiding a module.

## 4. Install flow

1. Admin uploads/points to a module package (or it's already present under `modules/` in the deployed image — see open item in `CHECKLIST.md` re: where packages come from).
2. `ModuleRegistryModule` validates: manifest schema, `compatibleAppVersion` against the running platform version, `dependsOn` all already `installed`, no `basePath`/`apiPrefix` collision with another installed module, `locales.supported` includes the platform default language.
3. Runs `migrations/*.sql` in order inside a transaction; records each in `module_migrations` with a checksum.
4. Registers `permissions` rows; applies `defaultRolePermissions` (first install only).
5. Registers `menu` entries (validated: every `parentId` resolves, no cycles).
6. Merges `locales/*.json` into the running i18n dictionaries.
7. Sets `module_registry.status = installed`.
8. Triggers the orchestrated backend restart (health-checked; registry write happens **before** restart so a crash mid-restart resumes as "installed, needs mount" rather than losing the record) so the NestJS module actually mounts and its routes/controllers become live. Frontend picks up new lazy-loaded routes on next navigation/reload without a rebuild.

## 5. Upgrade / uninstall

- **Upgrade**: same validation as install but `migrations` only runs files not yet in `module_migrations` (still filename-ordered); `defaultRolePermissions` is **not** reapplied (would clobber admin's grants) — new permissions introduced by the upgrade are added to `permissions` with **no** default grant to any role (admin must consciously grant them). `onUpgrade(fromVersion, toVersion)` hook runs after migrations if present.
- **Uninstall**: menus/routes/permission-checks are removed from the live registry immediately (module effectively `disabled` + de-registered); **SQL migrations are not auto-reverted** by default (data loss on uninstall is dangerous to automate) — uninstall requires an explicit `--drop-data` confirmation that runs a module-provided `down` migration set if present, otherwise leaves the tables in place (orphaned but not deleted) and logs a warning. This is a deliberate safety choice — flagged in `CHECKLIST.md` for your confirmation since "delete on uninstall" is a legitimate alternative if you'd rather have clean uninstalls than safety-by-default.

## 6. What a module must never do

(Also encoded in `.claude/skills/papp-add-feature/SKILL.md` so AI-generated modules follow this automatically.)

- Never hardcode a role name in a permission check — always check a permission code, resolved from `role_permissions`.
- Never write directly to another module's tables — cross-module data access goes through that module's exported service/API, never raw SQL into someone else's schema.
- Never skip the `@Audit(...)` decorator on a create/update/delete endpoint.
- Never ship without an `ar` locale file (blocked at install validation).
- Never mark a field containing a secret without `@Sensitive()`.
- Never mark a **write** endpoint `access: "public"` without an accompanying abuse-mitigation note in the module's own docs (rate limiting and/or a resource-state check) — see §7.3.

## 7. Public / shareable routes

Some modules need a URL a link can be shared to and opened by someone with **no login at all** — your example: a survey module exposing `/survey/:surveyId` so a link can be handed out and filled in by anyone. This is a first-class, data-driven pattern, not a one-off hack per module.

### 7.1 Declaring a public route

Any entry in a module's `manifest.json` **`routes`** array (§2) can set `"access": "public"` instead of the default `"authenticated"`. A public route:
- Never redirects to the login page — the frontend router mounts it directly, no session required.
- Has **no `requiredPermission`** — permissions are an RBAC concept for logged-in users; an anonymous visitor has no roles to check. Any access rule for a public route (e.g. "this survey must currently be published/open") is **business logic in the module's own service**, not an RBAC permission.
- Its dynamic segment (`:surveyId` above) is exactly the same React Router / NestJS `:param` mechanism as any other route — nothing special is needed to support "the ID is in the URL."

### 7.2 Matching backend endpoint

The controller method backing a public route is marked with a `@Public()` decorator, checked by the global `JwtAuthGuard` itself (not bypassed by omitting the guard — the guard is still applied everywhere, it just short-circuits to "no user" instead of rejecting when it sees `@Public()`). `PermissionGuard` similarly no-ops when there's no authenticated user *and* the route is marked public; it still rejects an unauthenticated request to any endpoint that isn't. This keeps "every endpoint goes through both guards, no exceptions" true (`FEATURE_TEMPLATE.md` §1) while still allowing deliberate, explicit public access.

```ts
@Get('public/:surveyId')
@Public()
async getPublicSurvey(@Param('surveyId') id: string) {
  return this.surveys.getIfPublished(id);   // service enforces "published" state itself — 404, not 403, if not
}
```

### 7.3 Public write endpoints need an abuse-mitigation plan

A public **read** (viewing a survey) is low-risk. A public **write** (submitting a survey response, anonymously, from the open internet) is a standing abuse vector — bots, spam, scraping. Any module adding one must apply the platform's shared `ThrottlerGuard` (per-IP rate limit, default a conservative limit set in `system_settings` under `security.public_endpoint_rate_limit`, admin-tunable like password policy, §6.3 of `ARCHITECTURE.md`) and document in the module's own notes why the limit chosen is reasonable for that action. This isn't optional — see the "never" list in §6.

### 7.4 Audit logging for anonymous actions

`audit_log.actor_user_id` is nullable; an `actor_type` column (`'user' | 'system' | 'anonymous'`) distinguishes "no user because it's a background job" from "no user because it's a genuine anonymous visitor." IP address and user agent are still captured for anonymous actions — they're the only identifying trace available, which is exactly why they matter more here, not less.

### 7.5 Route ownership stays simple

A module's `basePath` (§2) is still the single collision-checked namespace boundary — `/survey` belongs entirely to the survey module, public and authenticated routes alike. Nothing new is needed for uniqueness beyond what §4 step 2 already validates; `/survey/:surveyId` and `/survey/manage` simply both nest under the one already-reserved prefix.
