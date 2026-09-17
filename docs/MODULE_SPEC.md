# Module Manifest Spec

How a feature (Library Catalog, Borrowing, Finance, …) plugs into the base platform. Modeled on Odoo/Gibbon's module manifests, adapted for the "dynamic install, orchestrated restart" strategy agreed in `docs/DECISIONS.md` (D15).

## 1. Package layout

**Real, load-bearing constraints, confirmed by building the first real module (`library_catalog`, D55-D57) — not illustrative details:**

- **The directory name must equal the manifest `key` literally, snake_case** (`modules/library_catalog/`, not a hyphenated name) — `ModuleRegistryService`/the module loader build the on-disk path directly from the key string.
- **`backend.entry` must point to compiled CommonJS output (`*.js`), never raw `.ts`** — plain Node cannot `import()` NestJS-decorated TypeScript, even with type-stripping. Every module ships a small own `tsconfig.json` (extending the shared base config) that compiles `backend/*.ts` → `backend/*.js` in place; **both the TypeScript source and its compiled output are checked into git together**.
- **A module cannot directly import `apps/api/src/common/**`'s real decorators/guards** (`@Public()`, `@RequirePermission()`, `@Audit()`, `@CurrentUser()`, `MustChangePasswordGuard`) — only `apps/api/dist/**` exists as loadable JS at runtime. Until a shared `@papp/platform-kit` package exists, every module ships a small local `backend/platform.ts` re-declaring these as thin metadata shims against the exact same literal string keys the real global guards read (see D57 in `docs/DECISIONS.md` for the full rationale and the current known keys). `PublicThrottlerGuard` is the one exception a module should import for real (from `apps/api/dist/...`), since it's genuine shared logic, not a metadata marker.
- **A module's own tests live under its own `test/` directory, never under `apps/api/test/` or `apps/web/tests/`** (root D77) — see §9.4.

```
modules/library_catalog/
├── manifest.json
├── DOCUMENTATION.md                    -- this module's own technical reference (§9) — read before touching it
├── DECISIONS.md                        -- this module's own append-only decisions/gotchas log (§9)
├── tsconfig.json                       -- compiles backend/*.ts -> backend/*.js in place (D56)
├── migrations/
│   ├── 001_create_books_table.sql
│   ├── 002_add_isbn_index.sql
│   └── ...
├── backend/
│   ├── platform.ts                     -- local decorator/guard shims (D57) — see docs/DECISIONS.md
│   ├── library-catalog.module.ts       -- NestJS module source
│   ├── library-catalog.module.js       -- ...and its compiled output, both checked in
│   ├── books.controller.ts / .js
│   ├── books.service.ts / .js
│   └── ...
├── frontend/
│   ├── routes.tsx                      -- exports authenticatedRoutes/publicRoutes (§7.6) — generically discovered, never imported by name
│   ├── pages/
│   │   └── BooksListPage.tsx
│   └── ...
├── locales/
│   ├── ar.json
│   └── en.json
└── test/                               -- this module's OWN tests only (§9.4, root D77) — never apps/api/test or apps/web/tests
    ├── backend/
    │   ├── books.service.spec.ts       -- Jest unit spec (mocked PrismaClient, no DB)
    │   └── library-catalog.e2e-spec.ts -- Jest e2e spec (real install, real Testcontainers Postgres)
    └── frontend/
        └── some-component.test.tsx     -- Vitest + React Testing Library component test
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

  "settings": [
    // Odoo-style: a module can declare its own admin-editable settings, not just permissions/menus.
    // Each entry becomes a system_settings row (ARCHITECTURE.md §6.3), namespaced under the module key
    // so it can never collide with core's or another module's keys. Seeded with `default` on first
    // install ONLY (same "first install only" rule as defaultRolePermissions below — an upgrade never
    // re-seeds and clobbers an admin's chosen value). See §7 for the install-time registration flow.
    {
      "key": "library_catalog.loan_policy",             // full system_settings key = "<moduleKey>.<name>"
      "type": "json",                                     // "json" | "string" | "number" | "boolean" — informs the Settings UI's editor widget
      "default": { "maxBooksPerStudent": 2, "loanPeriodDays": 7, "finePerDay": 1 },
      "labelKey": "library_catalog.settings.loan_policy", // i18n key for the Settings screen section heading
      "requiredPermission": "library_catalog.settings.update"  // must also appear in this manifest's permissions array
    }
  ],

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
4. Registers `permissions` rows; applies `defaultRolePermissions` (first install only). Seeds `settings` entries into `system_settings` with their `default` value (first install only — see §8).
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

### 7.6 How a module's routes/menu actually get mounted — the generic loader (root DECISIONS.md D78)

**Nothing in `apps/web/src/**` ever imports a specific module.** `App.tsx`/`PageLayout.tsx` mount every installed module's routes and sidebar entries through a fixed, generic contract — the platform accepts "whatever module is installed," it never needs its own code changed to add or remove one (same principle as backend module mounting, §4, which was already this way).

**A module's own contract, unchanged from §1/§2:**
- `frontend/routes.tsx` (the manifest's `frontend.entry`) exports exactly two arrays, under these EXACT names — no other export name is discovered:
  ```ts
  import type { ModuleRouteEntry } from '../../../apps/web/src/shared/modules/types';
  export const authenticatedRoutes: ModuleRouteEntry[] = [ { path: '/your-module/x', element: <YourPage /> } ];
  export const publicRoutes: ModuleRouteEntry[] = [];   // [] if the module has none — never omit the export
  ```
- `manifest.json`'s own `routes[]`/`menu[]` arrays (§2) are the single source of truth for WHICH of a module's routes/menu items are actually reachable once installed — `routes.tsx` only supplies the React element each `pattern`/`route` resolves to.

**How the platform discovers and mounts them, with zero per-module code:**
1. `apps/web/src/shared/modules/discovery.ts` uses Vite's `import.meta.glob('modules/*/frontend/routes.tsx', { eager: true })` — a WILDCARD glob, resolved at build time, that bundles every module physically present under `modules/*` without naming any of them.
2. `GET /modules/frontend-manifest` (`@Public()`, no permission gate — same category as `GET /i18n/:lang`) returns, for every currently INSTALLED module, just `{key, basePath, routes, menu}` — never the full admin manifest (see `FrontendModuleManifest`'s own docblock for exactly why it's this narrow).
3. `apps/web/src/shared/modules/useInstalledModules.ts`'s hooks cross-reference (1) against (2) at runtime: only an installed module's `authenticatedRoutes`/`publicRoutes` actually get spread into `App.tsx`'s `<Routes>` trees, and only its `menu[]` entries get flattened (via `buildModuleMenuEntries.ts`) into `PageLayout.tsx`'s sidebar.
4. A menu entry's `icon` (a plain string) resolves through `shared/modules/menuIcons.tsx`'s small name→component map, falling back to a generic icon for any name not yet added there — the ONE deliberately-accepted, purely cosmetic exception to "zero platform edits" (a module is fully installable and usable without ever touching this map).

**Guard**: `npm run lint:no-module-specific-platform-code` (`scripts/lint-no-module-specific-platform-code.ts`, part of `lint:manifests`) fails CI if any file under `apps/api/src/**`/`apps/web/src/**` imports a real module directory by literal path (`modules/<key>/...`) — the enforced version of "installing/uninstalling a module changes no platform file."

**Known limitation** (documented, not silently accepted): `import.meta.glob(..., { eager: true })` ships every module's frontend JS in the main bundle regardless of install status — there is still no true runtime plugin-loading/module-federation mechanism (same accepted limitation as the backend's own dist-import exception, §1). Uninstalling a module makes it unreachable (no route, no menu item) immediately; it does not shrink the JS bundle until the next build.

## 8. Module-defined settings

Raised as a gap by real domain input (a library module needing admin-editable `loan_period_days`/`fine_per_day`/`max_books_per_student` — see `docs/LIBRARY_MODULE_REQUIREMENTS.md` §8): permissions and menus were already data-driven per module (§2), but **settings were not** — only core had a way to declare and seed its own `system_settings` keys. This section closes that gap, matching Odoo's per-app settings pattern.

### 8.1 How it works

A module's `manifest.json` `settings` array (§2) declares its own admin-editable configuration. At install time (§4), each entry's `key` (always `<moduleKey>.<name>`, enforced so modules can never collide with core's or each other's settings) is seeded into `system_settings` with its `default` value — **first install only**, exactly like `defaultRolePermissions` (§4/§5): an upgrade never re-seeds a settings key, so it never clobbers a value an admin already changed. A `key` introduced by an upgrade (a genuinely new setting the module didn't have before) is seeded then, since there's nothing to clobber yet.

### 8.2 Reading and writing

Read through the same cached `SettingsService` core already uses (`ARCHITECTURE.md` §6.3) — modules don't get their own separate settings-storage mechanism, just their own namespaced keys in the one shared table. Writing a module's setting requires the `requiredPermission` declared alongside it (which must itself be one of the module's own declared `permissions`, §2) — never hardcoded to `admin`, same rule as everything else in this platform (`ARCHITECTURE.md` §7.4 stays the only hardcoded-role exception anywhere).

### 8.3 Settings UI

The core Settings screen (`ARCHITECTURE.md` §6.3, currently "Password Policy / Session Timing / Notification Templates" tabs) grows one additional section per **installed** module that declares any `settings` entries, rendered generically from each entry's `type`/`labelKey`/`default` shape rather than needing bespoke UI per module — an uninstalled module's settings section simply isn't shown (though its underlying `system_settings` rows are left in place on uninstall, per the same safe-by-default policy as everything else, D26).

## 9. Per-module documentation & decisions (D69)

Two real, uncommitted-to-nobody problems this section fixes: (1) `docs/DECISIONS.md` is one long, append-only, whole-platform file — after two modules it already mixes core architecture calls with module-specific gotchas nobody but that module's next editor needs, making both harder to scan; (2) nothing forced a future session/agent to actually go *read* what a module's own build already learned before changing it, so the same mistake (or the same design question) could get silently re-litigated per module per session. Every module — **including new ones from this point on** — ships two files at its root, alongside `manifest.json` (§1's file tree):

```
modules/<key>/
├── manifest.json
├── DOCUMENTATION.md   -- what this module IS: data model, permissions, routes, key files, gotchas, how to extend it
├── DECISIONS.md       -- what was DECIDED building/fixing it: append-only, this module's own numbered log
└── ...
```

### 9.1 `DOCUMENTATION.md` — required sections

A technical reference for whoever (human or agent) next touches this module, written so they don't have to reconstruct it by re-reading every source file cold:

1. **Purpose** — one or two sentences, what real-world problem this module solves.
2. **Data model** — every table this module owns (its migration files are the source of truth; this is the human-readable map on top), with the non-obvious relationships/constraints called out (a partial index, an app-level-not-DB-level rule, a JSONB column's real shape).
3. **Permissions** — a table of every code in its manifest, one line each: code, what it actually gates, which controller method(s) check it.
4. **Routes** — backend (method, path, permission or `@Public()`) and frontend (pattern, access level, component) — call out anything public explicitly, per §7.
5. **Key files** — a short map of the biggest/most load-bearing files and what each owns (not every file — the ones a newcomer would otherwise have to guess about).
6. **Known gotchas** — non-obvious behavior a future editor would otherwise rediscover the hard way (an ordering dependency, a validation quirk, a thing that looks like a bug but isn't, or a thing that looks fine but was).
7. **How to extend** — the concrete steps for the module's own most-likely-next change (a new question type, a new entity, a new report), not a generic restatement of `FEATURE_TEMPLATE.md`.

### 9.2 `DECISIONS.md` — format and scope

**Same append-only, numbered-entry table format as the root `docs/DECISIONS.md`** (never a silent edit of an old row — a correction is a new row), but scoped to decisions **specific to this module only**. Entry IDs are prefixed with the module key to stay unambiguous against the root file's plain `Dnn` ids, e.g. `SURVEY-D1`, `LIBRARY_CATALOG-D1`, `TEMPLATE-D1` — numbered independently per module, not a shared global counter.

- **Never restate a platform-wide decision already in the root `docs/DECISIONS.md`** — cross-reference it by ID instead (`"per D57"`, `"see root D64"`). This file is for calls, gotchas, and bugs-found-and-fixed that only make sense in this module's own context.
- A genuine bug found and fixed while building or maintaining the module (the kind root `docs/DECISIONS.md` D61-D63/D67 record) belongs here too, in the same "what broke, why, how it was found, how it was fixed, how it was verified" level of detail — this is exactly the log that prevents the same class of bug recurring the next time someone extends this module.
- Status column uses the same values as the root file: `DECIDED` / `PROPOSED` / `ASSUMED`. An `ASSUMED` row stays in this module's own file, scoped and numbered the same as everything else here — a module-local assumption doesn't get promoted to `docs/ASSUMPTIONS.md` (that file is platform-wide standing assumptions only, split out of `docs/DECISIONS.md` for the same reason this section exists: not mixing whole-platform concerns with one module's own).

### 9.3 When to read / write these

- **Read both files, in full, before making any change to an existing module** — before `docs/ARCHITECTURE.md`/`MODULE_SPEC.md` even, since those are platform-wide and this module's own files are what tell you what's actually different about it. This is now step 0 of `.claude/skills/papp-add-feature/SKILL.md`'s checklist.
- **Update `DECISIONS.md`** the moment you make a call, find a gotcha, or fix a bug — not batched at the end of a session, for the same reason the root file is append-as-you-go rather than reconstructed from memory afterward.
- **Update `DOCUMENTATION.md`** whenever something it describes actually changes shape (a new table/entity, a new permission, a new route, a gotcha that no longer applies or a new one that does) — it is a living reference, not a one-time changelog.
- A brand-new module scaffold (§1) starts both files non-empty: `DOCUMENTATION.md` with at least a real Purpose/Data model/Permissions/Routes section (even a v1 module has these), `DECISIONS.md` with whatever real calls were made getting it to a working state (there is always at least one — even "copied `modules/template` and renamed X/Y/Z" is worth one line if nothing else came up).
- `modules/template/` (§10) is the canonical worked example of both files, kept intentionally minimal — copy its shape, not necessarily its length.

### 9.4 Where a module's own tests live (root D77)

**Platform tests and module tests are two different things, kept in two different places:**

- **Platform tests** — this project's OWN test suite, covering core (`Users`, `Roles`, `Permissions`, `Audit`, `Notifications`, `ModuleRegistry`, `I18n`, `Auth`/`Sessions`) and cross-cutting concerns (the permission-matrix helper, the module-registry lifecycle itself). These live under `apps/api/test/**` (Jest: unit/`*.spec.ts`, integration/`*.integration-spec.ts`, e2e/`*.e2e-spec.ts`) and `apps/web/tests/**` (Vitest component tests, Playwright e2e under `tests/e2e/`).
- **Module tests** — a module's OWN unit/e2e/component tests, covering ONLY that module's own services/controllers/pages. These live INSIDE the module, per §1's file tree:
  - `modules/<key>/test/backend/*.spec.ts` — Jest unit specs (mocked `PrismaClient`, no DB — same `(service as unknown as {prisma}).prisma = mockPrisma` reflection idiom every module already uses).
  - `modules/<key>/test/backend/*.e2e-spec.ts` — Jest e2e specs (real install via `ModuleRegistryService`, real Testcontainers Postgres, real HTTP via Supertest).
  - `modules/<key>/test/backend/*.integration-spec.ts` — Jest integration specs, when a module needs one (none do yet).
  - `modules/<key>/test/frontend/*.test.tsx` — Vitest + React Testing Library component tests (e.g. a rendering-safety guard like `modules/website/test/frontend/website-safe-markdown.test.tsx`).
  - A Playwright end-to-end spec that drives a module's UI through a real running dev server (browser automation, full stack) is a platform-level test even when it only exercises one module's flow — it stays under `apps/web/tests/e2e/`, not inside the module (see `apps/web/tests/e2e/survey.spec.ts`).

**Why split at all**, not just "put everything under `apps/api/test/modules/<key>/`" (the pattern every module used before root D77 — a real, if undocumented, gap flagged in root `docs/DECISIONS.md` D68): a module is meant to be self-contained (§1 — its own manifest, migrations, backend, frontend, locales, `DOCUMENTATION.md`/`DECISIONS.md`), and its tests are as much a part of "what this module is" as its own migrations are. Leaving them in the platform's own test tree means deleting or relocating a module (uninstall, extraction into its own package, a future module marketplace) silently orphans or forgets its tests, and a module's own `DOCUMENTATION.md`/`DECISIONS.md` can't honestly claim the module is self-contained while its test suite lives somewhere else entirely.

**How the test runners find them** (so this doesn't silently stop working again): `apps/api/test/jest.base.config.ts` sets `roots: [rootDir, modulesRoot]` and exports `modulesRoot` (`<rootDir>/../../modules`); `jest.unit.config.ts`/`jest.integration.config.ts`/`jest.e2e.config.ts` each add a `${modulesRoot}/*/test/backend/*.<ext>` pattern to their own `testMatch` alongside their existing `<rootDir>/test/**` pattern. `apps/api/tsconfig.test.json`'s `include` has a matching `../../modules/*/test/backend/**/*.ts` entry (ts-jest compiles against this project; without it, ts-jest throws "file is not listed within the file list of project" for any spec file under `modules/**`, the exact class of bug D62 already fixed once for `apps/api/test/**` itself). `apps/web/vitest.config.ts`'s `test.include` has a matching `../../modules/*/test/frontend/**/*.test.{ts,tsx}` entry alongside its own `tests/**` pattern.

**Every new module (§10) starts with this layout from scratch** — copy `modules/template/test/backend/items.service.spec.ts` as the worked example for a unit spec; there is currently no template frontend component test (template's own pages all need `Router`/`i18n` context to render — see `modules/website/test/frontend/website-safe-markdown.test.tsx` for a real, self-contained frontend test example instead).

## 10. `modules/template` — the canonical scaffold for a new module

A real, installable, fully-working module whose only purpose is to be copied. It deliberately exercises **every** `manifest.json` option this spec defines (§2) — permissions, `defaultRolePermissions`, `roleAccessPolicy`/`roleAccessLocked`, a module-defined `settings` entry (§8, which neither `library_catalog` nor `survey` happened to need), a nested `menu` (a parent entry with a child), both an `authenticated` and a `public` route (§7), and the full backend/frontend/migrations/locales layout (§1) — backed by one deliberately simple entity (`TemplateItem`: title/description/status/owner) so the plumbing is what's on display, not domain complexity.

To start a new module:
1. Copy `modules/template/` to `modules/<your_key>/` (snake_case, matching §1's directory-equals-key rule).
2. Rename every `template`/`Template`/`TEMPLATE` occurrence to your module's key (file names, class names, manifest `key`/permission codes/table prefix, route paths, locale keys) — there is no automated rename script; grep for `template` case-insensitively inside the copied directory and check every hit.
3. Replace `TemplateItem` with your module's real entity/entities — the migration, Prisma mirror, DTOs, service, and controllers all follow the same shape, just with your real fields.
4. Delete whichever of the demonstrated options you don't need (not every module needs a `settings` entry or a public route) — but keep the ones you do need shaped exactly like the template shows them; that shape is what's been verified to actually work end-to-end (real install, real browser/API smoke test — see `modules/template/DOCUMENTATION.md`).
5. Replace `modules/template/DOCUMENTATION.md`/`DECISIONS.md` with your own from the start (§9.3) — don't leave the template's own placeholder content in a real module.
