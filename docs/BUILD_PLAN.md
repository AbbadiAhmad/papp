# papp — Build Plan

Status: buildable implementation plan derived from `ARCHITECTURE.md`, `MODULE_SPEC.md`, `FEATURE_TEMPLATE.md`, `TESTING_STRATEGY.md`, and `DECISIONS.md`. Nothing here contradicts a `DECIDED` item in `DECISIONS.md`; where this plan had to make a call those docs left open, it is marked **[PLANNER CALL]** with the reasoning, so the user can override it cheaply.

This plan is for three roles: an **Orchestrator** (sequences the work, not touched directly by this doc), a **Developer** agent (writes application code), and a **Tester** agent (writes tests). Both work **phase by phase, on the single branch** (D4) — a phase is not "done" until its acceptance criteria pass, and the next phase does not start until then. Within a phase, Developer and Tester own disjoint files (listed explicitly per phase) so they can work the same phase without merge conflicts.

**Convention used throughout this plan — "plumb early, feature later":** a few pieces of core infrastructure are needed by an earlier phase than the phase that "owns" the full feature (e.g. Auth needs `system_settings` values before the Settings admin screen exists). In those cases the earlier phase builds the minimal plumbing (a table + a bare service, no caching/admin UI) and the owning phase later extends it. This is called out explicitly at each occurrence so it's never mistaken for scope creep.

---

## 1. Repo layout

**Monorepo tool: npm workspaces.** [PLANNER CALL] No monorepo tool is pinned in `DECISIONS.md`. npm workspaces is the simplest option that satisfies everything actually required (shared `node_modules`, cross-package TS project references, one `npm install` at the root) without adopting a build-graph tool (Nx/Turborepo) nothing in the docs asked for. Revisit only if build times become a real problem once modules multiply.

```
papp/
├── apps/
│   ├── api/                          # NestJS backend
│   │   ├── src/
│   │   │   ├── main.ts               # bootstrap: applies core migrations, mounts installed modules, starts Nest
│   │   │   ├── app.module.ts
│   │   │   ├── core/
│   │   │   │   ├── migrations/       # core's OWN raw SQL migration files (see §2 note on migration strategy)
│   │   │   │   │   └── 0000_bootstrap_registry.sql, 0001_create_users.sql, ...
│   │   │   │   ├── auth/             # AuthModule, AuthService, AuthController, strategies
│   │   │   │   ├── sessions/         # SessionsModule
│   │   │   │   ├── users/            # UsersModule (incl. excel import/export)
│   │   │   │   ├── roles/            # RolesModule
│   │   │   │   ├── permissions/      # PermissionsModule, PermissionGuard
│   │   │   │   ├── audit/            # AuditModule, AuditInterceptor
│   │   │   │   ├── notifications/    # NotificationsModule (core, mandatory)
│   │   │   │   ├── settings/         # SettingsService (system_settings), SettingsController
│   │   │   │   ├── module-registry/  # ModuleRegistryModule, MigrationRunner, manifest validator, module loader
│   │   │   │   └── i18n/             # I18nModule
│   │   │   ├── common/
│   │   │   │   ├── decorators/       # @Public, @RequirePermission, @Audit, @CurrentUser
│   │   │   │   ├── guards/           # JwtAuthGuard, PermissionGuard, PublicAwareThrottlerGuard
│   │   │   │   ├── interceptors/     # AuditInterceptor
│   │   │   │   └── sensitive/        # DMMF-based sensitive-field lookup helper (see Phase 3)
│   │   │   └── prisma/               # PrismaService/PrismaModule (client only, no `prisma migrate` usage)
│   │   ├── prisma/schema.prisma      # hand-maintained model definitions, core + (later) module models
│   │   ├── test/                     # unit, integration (testcontainers), e2e; test/support/permission-matrix.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/                          # React SPA
│       ├── src/
│       │   ├── main.tsx, App.tsx
│       │   ├── app/                  # shell: router, MUI ThemeProvider (RTL), i18n bootstrap, auth/session context
│       │   ├── core/                 # pages: login, force-password-change, users, roles, permissions,
│       │   │                         #   sessions, audit, settings, notifications, modules-admin
│       │   ├── shared/                # PageLayout, usePermission/<Can>, formatDate/formatNumber, api client
│       │   └── locales/core/{ar,en}.json
│       ├── tests/                    # vitest+RTL unit/component; playwright/ e2e
│       ├── Dockerfile
│       └── package.json
├── modules/                          # installable feature modules, per MODULE_SPEC.md §1 — NOT npm workspace
│   │                                 #   packages; imported in-place by apps/api (tsconfig `include`) and
│   │                                 #   apps/web (vite glob import). [PLANNER CALL] — see note below.
│   └── library-catalog/              # built in Phase 8
│       ├── manifest.json
│       ├── migrations/
│       ├── backend/
│       ├── frontend/
│       └── locales/
├── packages/
│   └── shared-types/                 # cross-cutting TS types/DTOs shared by api+web (AuthUser, ManifestSchema,
│                                     #   TargetType, permission-code string literal unions, etc.)
├── scripts/                          # CI static-check scripts (not a workspace package)
│   ├── lint-permissions.ts           # manifest ⇄ controller permission-code consistency
│   ├── lint-locales.ts               # ar/en key-parity check across core + every module
│   └── lint-no-hardcoded-roles.ts    # greps for role-name checks outside the one D12 file
├── docs/                             # existing planning docs (unchanged) + this file
├── .github/workflows/ci.yml          # Phase 7
├── docker-compose.yml                # exactly db, api, web (D5)
├── .env.example
├── package.json                      # root, npm workspaces: ["apps/*", "packages/*"]
├── tsconfig.base.json
└── CLAUDE.md
```

**[PLANNER CALL] Modules live in-repo, not as a package registry.** `DECISIONS.md`/`MODULE_SPEC.md` describe *dynamic install* (D15) but never say where a module package physically comes from beyond "already present under `modules/` in the deployed image" (flagged as an open item in the original checklist, since resolved as "not blocking"). This plan keeps that: modules are part of the same git repo/Docker image, and "install" means the `ModuleRegistryModule` runs their migrations + registers their permissions/menu/locales + triggers the orchestrated restart that mounts their NestJS module — not a fetch from anywhere external. A real module marketplace/upload mechanism is out of scope until asked for.

**[PLANNER CALL] Core tables use the same raw-SQL migration mechanism as feature modules, not `prisma migrate`.** D16 only says *modules* ship their own raw SQL migrations instead of one global Prisma migration history; it doesn't say how core's own tables (`users`, `roles`, …) get created. Running `prisma migrate dev/deploy` for core while modules use raw SQL + `module_migrations` would mean two parallel migration systems in one codebase, with two different sources of truth for "what's applied." Instead: core is modeled as a single **non-uninstallable pseudo-module** with `module_registry.key = 'core'` (bundling Auth/Sessions/Users/Roles/Permissions/Audit/Notifications/ModuleRegistry/I18n, matching how `CLAUDE.md` already groups them as one "core" concept), whose migrations live at `apps/api/src/core/migrations/*.sql` and are tracked in `module_migrations` with `module_key = 'core'`, applied by the exact same `MigrationRunner` used for real modules. **`prisma migrate` is never run in this repo** — `prisma generate` only, against a hand-maintained `schema.prisma` that mirrors what the raw SQL actually created. Remove `migrate`-family scripts from `apps/api/package.json` to make misuse harder.

---

## 2. Prisma schema outline (core tables)

Field-level outline, not DDL — concrete enough to write `schema.prisma` directly from. `@Sensitive` here is **not** a real Prisma attribute (Prisma has none) — see the Phase 3 note: it's a `///` doc-comment convention read from Prisma's DMMF at runtime.

```prisma
model User {
  id                 String    @id @default(uuid()) @db.Uuid
  email              String    @unique
  name               String
  externalId         String?   @unique              // D30 "ID (national/employee)" import key
  department         String?
  /// @Sensitive
  passwordHash       String
  mustChangePassword Boolean   @default(false)
  isActive           Boolean   @default(true)
  lastLoginAt        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  createdBy          String?   @db.Uuid

  userRoles          UserRole[]
  sessions           UserSession[]
  @@map("users")
}

model Role {
  id           String   @id @default(uuid()) @db.Uuid
  code         String   @unique                     // "admin" | "library_assistant" | "finance" | "reader" | custom
  nameI18nKey  String
  isSystem     Boolean  @default(false)              // seeded base roles (D9) — never deletable
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  rolePermissions RolePermission[]
  userRoles       UserRole[]
  @@map("roles")
}

model Permission {
  id                 String   @id @default(uuid()) @db.Uuid
  code               String   @unique                // "users.create", "library_catalog.books.delete"
  moduleKey          String                            // "core" | module manifest key
  category           String
  descriptionI18nKey String
  createdAt          DateTime @default(now())

  rolePermissions RolePermission[]
  @@map("permissions")
}

model RolePermission {
  roleId       String   @db.Uuid
  permissionId String   @db.Uuid
  grantedAt    DateTime @default(now())
  grantedBy    String?  @db.Uuid

  role       Role       @relation(fields: [roleId], references: [id])
  permission Permission @relation(fields: [permissionId], references: [id])
  @@id([roleId, permissionId])
  @@map("role_permissions")
}

model UserRole {
  userId     String   @db.Uuid
  roleId     String   @db.Uuid
  assignedAt DateTime @default(now())
  assignedBy String?  @db.Uuid

  user User @relation(fields: [userId], references: [id])
  role Role @relation(fields: [roleId], references: [id])
  @@id([userId, roleId])
  @@map("user_roles")
}

model UserSession {
  id                String    @id @default(uuid()) @db.Uuid   // session_id, also the JWT `sid` claim
  userId            String    @db.Uuid
  /// @Sensitive
  refreshTokenHash  String
  issuedAt          DateTime  @default(now())
  lastActiveAt      DateTime  @default(now())
  expiresAt         DateTime
  ipAddress         String?
  userAgent         String?
  geoLocation       Json?                                     // A3: IP-based lookup result, nullable
  revokedAt         DateTime?

  user User @relation(fields: [userId], references: [id])
  @@map("user_sessions")
}

enum ActorType {
  user
  system
  anonymous
}

model AuditLog {
  id              String    @id @default(uuid()) @db.Uuid
  occurredAt      DateTime  @default(now())
  actorUserId     String?   @db.Uuid
  actorSessionId  String?   @db.Uuid
  actorType       ActorType
  category        String                                       // owning module key, e.g. "core.users"
  entityType      String
  entityId        String?
  action          String                                       // "login" | "create" | "update" | "delete" | "purge" | ...
  oldValue        Json?
  newValue        Json?
  ipAddress       String?
  userAgent       String?
  // DB-level invariant (added in the raw SQL migration, not expressible in Prisma):
  // CHECK (actor_type <> 'user' OR actor_user_id IS NOT NULL)
  @@map("audit_log")
}

model SystemSetting {
  key       String   @id                                       // "auth.password_policy", "security.public_endpoint_rate_limit", ...
  value     Json
  updatedBy String?  @db.Uuid
  updatedAt DateTime @updatedAt
  @@map("system_settings")
}

enum NotificationTargetType {
  user
  role
  all_users
}

model Notification {
  id           String                  @id @default(uuid()) @db.Uuid
  createdAt    DateTime                @default(now())
  category     String
  title        String
  bodyMarkdown String
  sentBy       String?                 @db.Uuid               // null = system-generated
  targetType   NotificationTargetType
  targetId     String?                 @db.Uuid               // user_id or role_id; null when all_users

  recipients NotificationRecipient[]
  @@map("notifications")
}

model NotificationRecipient {
  notificationId String    @db.Uuid
  userId         String    @db.Uuid
  readAt         DateTime?
  emailedAt      DateTime?

  notification Notification @relation(fields: [notificationId], references: [id])
  @@id([notificationId, userId])
  @@map("notification_recipients")
}

enum ModuleStatus {
  installing
  installed
  upgrading
  disabled
  uninstalling
  failed
}

model ModuleRegistryEntry {
  key              String       @id                             // "core" or a module's manifest key
  version          String
  status           ModuleStatus
  installedAt      DateTime?
  updatedAt        DateTime     @updatedAt
  manifestSnapshot Json?
  @@map("module_registry")
}

model ModuleMigration {
  id         String   @id @default(uuid()) @db.Uuid
  moduleKey  String                                              // "core" or the module's manifest key
  filename   String
  checksum   String
  appliedAt  DateTime @default(now())
  @@unique([moduleKey, filename])
  @@map("module_migrations")
}
```

Module-owned tables (e.g. `library_catalog_books` in Phase 8) get their own `model` blocks appended to this same `schema.prisma` by hand, `@@map`-ed to the table the module's raw SQL migration actually created, then `npx prisma generate` (never `migrate`) is re-run to pick up the new client types.

---

## 3. Ordered build phases

Each phase lists: what's built, the exact Developer/Tester file split, and "Done when" acceptance criteria that gate the next phase.

### Phase 0 — Repo scaffold + migration/registry plumbing

**Developer builds**
- Root: `package.json` (workspaces), `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml` (db/api/web only), `.dockerignore`.
- `apps/api`: NestJS skeleton (`main.ts`, `app.module.ts`), `apps/api/Dockerfile`, `apps/api/package.json`.
- `apps/api/src/prisma/`: `PrismaModule`/`PrismaService` (client wiring only).
- `apps/api/prisma/schema.prisma`: **only** `ModuleRegistryEntry` + `ModuleMigration` models for now (rest arrive per-phase alongside their migration files — see §2 outline for the eventual full set).
- `apps/api/src/core/migrations/0000_bootstrap_registry.sql`: `CREATE TABLE IF NOT EXISTS module_registry (...)`, `module_migrations (...)` — the one migration file allowed to be non-checksum-tracked (it creates the tracking tables themselves) and it must be idempotent (`IF NOT EXISTS`).
- `apps/api/src/core/module-registry/migration-runner.service.ts`: applies `*.sql` files under a given directory in filename order, records each in `module_migrations` (checksum = sha256 of file contents), skips already-applied files, throws on checksum mismatch. Called from `main.ts` at bootstrap for `apps/api/src/core/migrations/*` with `moduleKey = 'core'`, seeding a `module_registry` row `{ key: 'core', status: 'installed' }` on first run.
- `apps/web`: Vite + React + TS skeleton, `apps/web/Dockerfile`, `apps/web/package.json`, placeholder `App.tsx`.
- `packages/shared-types`: empty barrel package, wired into both apps' `tsconfig` paths.

**Tester builds**
- `apps/api/test/jest.unit.config.ts`, `jest.integration.config.ts` (Testcontainers wiring), `jest.e2e.config.ts`.
- `apps/api/test/health.e2e-spec.ts`: `GET /health` → 200.
- `apps/api/test/core/migration-runner.integration-spec.ts`: applies a fixture `.sql` dir against a throwaway Postgres container, re-applies (idempotent, no duplicate rows), and asserts a checksum mismatch on an edited already-applied file throws.
- `apps/web/vitest.config.ts`, one smoke test rendering `<App />`.
- `apps/web/playwright.config.ts` (no specs yet — Phase 6 fills it in).
- `test/support/permission-matrix.ts`: typed stub only (signature from `TESTING_STRATEGY.md` §2), implemented for real in Phase 2 once roles/permissions exist.

**Done when:** `npm install` succeeds at root; `docker-compose up` brings up all three services, `api` passes its health check; `npm run build` succeeds in every workspace; the migration-runner integration test and both smoke tests pass; no lint errors.

---

### Phase 1 — Auth + Sessions + Users core

*Plumbing pulled forward (see convention note): a minimal, uncached `system_settings` table + `SettingsService.get/set` — Auth needs `auth.password_policy` and `auth.token_lifetimes` values immediately; the admin-facing Settings screen and caching/invalidation arrive in Phase 4.*

**Developer builds**
- `apps/api/src/core/migrations/0001_create_users.sql`, `0002_create_user_sessions.sql`, `0003_create_system_settings.sql` (+ seed rows for `auth.password_policy` defaults: min 10 chars/1 letter+1 number/5 attempts→15min lockout, and `auth.token_lifetimes` defaults: 15min access / 30d refresh, per §6.2/6.3).
- `prisma/schema.prisma`: add `User`, `UserSession`, `SystemSetting` models (§2).
- `apps/api/src/core/settings/settings.service.ts` (bare `get<T>(key)`/`set(key, value, updatedBy)`, no cache, no audit hookup yet — Phase 3/4 retrofit both).
- `apps/api/src/core/auth/`: `AuthModule`, `AuthController` (`POST /auth/login|refresh|logout`, `POST /auth/force-password-change`), `AuthService` (Argon2id via the `argon2` package [PLANNER CALL, carrying forward CHECKLIST.md's stated default], JWT issuance with payload `{ sub, sid }` only — no `roles`/permissions claim yet, added in Phase 2), refresh-rotation + reuse-detection logic, lockout logic reading `auth.password_policy`.
- `apps/api/src/common/guards/jwt-auth.guard.ts` (global guard; recognizes an — as yet undefined — `@Public()` metadata key so Phase 5 can add the decorator without touching this file again).
- `apps/api/src/core/sessions/`: `SessionsModule`, `SessionsController` (`GET /sessions/me`, `GET /sessions/user/:id` list, `DELETE /sessions/:id` revoke) — **guarded by `JwtAuthGuard` only for now**; `@RequirePermission` decorators are added retroactively in Phase 2 once `PermissionGuard` exists.
- `apps/api/src/core/users/`: `UsersModule`, `UsersController` (CRUD, `GET /users/me`, must-change-password enforcement middleware/guard) — same "auth-only for now" note as Sessions. **Excel import/export is deliberately deferred to Phase 2** (needs the role column from D30, which needs Roles to exist).
- `apps/web` gets no UI yet (Phase 6) — Phase 1 is backend-only.

**Tester builds**
- `apps/api/test/core/auth/auth.service.spec.ts` (unit: hashing, lockout math, token issuance/rotation, reuse-detection revokes the session).
- `apps/api/test/core/auth/auth.e2e-spec.ts`: login/refresh/logout flow; refresh rotates and invalidates the old token; reusing a rotated refresh token revokes the whole session; idle + absolute timeout both independently expire a session (per `TESTING_STRATEGY.md` §4).
- `apps/api/test/core/users/users.e2e-spec.ts`: CRUD happy paths, force-password-change blocks all other endpoints until changed.
- `apps/api/test/core/sessions/sessions.e2e-spec.ts`: admin can list/force-revoke another user's session; a revoked session's access token is rejected on the very next request.

**Done when:** all Phase 1 tests pass; a user can log in, refresh, be force-revoked, and be forced through password-change — all via `curl`/Supertest, no permission gating yet (that's Phase 2's job, not a gap in Phase 1's scope).

---

### Phase 2 — Roles + Permissions + `PermissionGuard` + D12 + Excel import/export

*If this phase proves too large for one session, split at the Excel-import boundary into 2a (RBAC core) and 2b (Excel import/export) — they touch different files and 2b has no dependents until Phase 6's UI.*

**Developer builds**
- `apps/api/src/core/migrations/0004_create_roles_permissions.sql` (roles, permissions, role_permissions, user_roles) + seed: the 4 base roles (D9) as `is_system = true`, and the **core permission catalog** registered the same way a module would (`users.view/create/update/delete/import`, `users.settings.view/update`, `roles.view/create/update/delete/assign`, `permissions.view/grant`, `sessions.view/revoke`, `audit.view/purge`, `notifications.send/templates.manage/view`, `modules.view/install/upgrade/uninstall`) with a `defaultRolePermissions`-equivalent seed matching FEATURE_TEMPLATE.md's shape (applied once, at this "first install" of core).
- `prisma/schema.prisma`: add `Role`, `Permission`, `RolePermission`, `UserRole`.
- `apps/api/src/core/roles/`, `apps/api/src/core/permissions/`: `RolesModule`/`PermissionsModule`, CRUD + grant-matrix endpoints (`PUT /permissions/roles/:roleId/grants`).
- `apps/api/src/common/decorators/require-permission.decorator.ts`, `apps/api/src/common/guards/permission.guard.ts`: resolves the caller's effective permission set **fresh from `role_permissions` on every request** (never from JWT claims — the JWT carries `roles` only, per §6.1/§7.2). Applied globally alongside `JwtAuthGuard`.
- Update `AuthService`'s token issuance to add a `roles: string[]` claim (role codes) to the access token — this is what the D12 check below reads.
- **The single D12 exception**, in exactly one file: `apps/api/src/core/permissions/permissions-page.guard.ts` — checks `req.user.roles.includes('admin') OR PermissionGuard's normal check`. Nowhere else in the codebase may contain a `role.code === 'admin'`-shaped check; enforced later by `scripts/lint-no-hardcoded-roles.ts` (Phase 7), but Developer must not add a second instance in the meantime.
- Retrofit: add `@RequirePermission(...)` to every Phase 1 `UsersController`/`SessionsController` method now that the codes exist.
- `apps/api/src/core/users/excel-import.service.ts` + `POST /users/import` / `GET /users/export`: D30 columns (name, email, ID, role, department), upsert matching **ID first, then email; a row whose ID matches one existing user but whose email matches a different existing user is rejected and reported, not silently applied** — **[PLANNER CALL]**, D30 doesn't specify this precedence; flag to user if a different rule is preferred.

**Tester builds**
- `test/support/permission-matrix.ts`: full implementation now (roles/permissions exist).
- `apps/api/test/core/permissions/permission-guard.spec.ts` (unit): asserts it queries the DB fresh per request — a regression test that changes a grant mid-test and confirms the very next request reflects it with **no caching/staleness**.
- `apps/api/test/core/permissions/d12-exception.spec.ts`: confirms `admin` reaches the Permissions page with zero grants; confirms every other Phase 1/2 endpoint rejects a similarly-ungranted admin (i.e., D12 doesn't leak into anything else).
- Retrofit permission-matrix e2e coverage onto the Users/Sessions e2e specs from Phase 1 using `expectPermissionEnforced(...)`.
- `apps/api/test/core/users/excel-import.e2e-spec.ts`: upsert-by-ID, upsert-by-email, the ID/email-conflict rejection case, and idempotent re-import.
- `scripts/lint-no-hardcoded-roles.ts` fixture test: a deliberately-broken sample file containing a second `role.code === 'admin'` check must fail the lint (written now even though the script itself is wired into CI in Phase 7).

**Done when:** every Phase 1+2 endpoint is covered by the permission-matrix helper (success for the granted role, 403 otherwise, 401 anonymous); D12 test passes; Excel import/export round-trips; no second hardcoded role check exists anywhere.

---

### Phase 3 — Audit: `AuditInterceptor`, `@Audit`, `@Sensitive`, manual purge

**Developer builds**
- `apps/api/src/core/migrations/0005_create_audit_log.sql`: **full table including `actor_type` from day one** (per §8.1 — not deferred to Phase 5, even though `'anonymous'` values won't appear until Phase 5's `@Public()` routes exist), plus the DB-level `CHECK (actor_type <> 'user' OR actor_user_id IS NOT NULL)` invariant.
- `prisma/schema.prisma`: add `AuditLog` + `ActorType` enum (§2).
- `apps/api/src/common/decorators/audit.decorator.ts` (`@Audit({ category, entityType, action })`), `apps/api/src/common/interceptors/audit.interceptor.ts` — applied **globally, opt-out not opt-in** (per §8.2): diffs before/after state for any handler carrying `@Audit`, writes the row; `actorType` is derived from `req.user` presence **and** the route's `@Public()` metadata (see Phase 5 — until then, `actorType` is always `'user'` since nothing is public yet).
- `apps/api/src/common/sensitive/sensitive-fields.ts`: reads Prisma's generated DMMF (`Prisma.dmmf.datamodel.models[].fields[].documentation`) at startup, builds a `Map<modelName, Set<fieldName>>` for every field documented `/// @Sensitive` in `schema.prisma` (this is the concrete mechanism behind §8.3's "field-level `@Sensitive()` marker... checked by the interceptor's diffing function before it ever serializes old/new values" — Prisma has no native decorator system, so the doc-comment + DMMF read is how that sentence becomes real code). `AuditInterceptor` consults this map before serializing `oldValue`/`newValue`, replacing matched fields with `"[redacted]"`.
- Retrofit: `AuthModule` writes login/logout audit rows directly (no before/after diff — per §8.2); `SettingsService.set()` (Phase 1 stub) now routes through the same `@Audit` path so `system_settings` writes are logged like any other update (per §6.3's "every write to `system_settings` goes through the normal `@Audit(...)` path").
- `apps/api/src/core/audit/`: `AuditModule`, `AuditController` (`GET /audit` query/filter by category, `POST /audit/purge` — `audit.purge` permission, body `{ cutoffDate }`, server rejects `cutoffDate >= today` in UTC, deletes `occurred_at < cutoffDate`, **then** writes the purge's own `audit_log` row (`category: 'core.audit'`, `action: 'purge'`, recording actor/cutoff/rows-deleted) — deliberately after the delete, so the purge is never itself unrecoverable-untraceable).

**Tester builds**
- `apps/api/test/security/sensitive-fields.schema-scan.spec.ts`: the schema-scan test from `TESTING_STRATEGY.md` §3 — enumerates every Prisma field matching `password`/`Hash`/`token`/`secret` name patterns and fails the build if one lacks a `/// @Sensitive` doc-comment.
- `apps/api/test/core/audit/audit.interceptor.spec.ts` (unit): a matched `@Sensitive` field never appears un-redacted in a captured diff, even when the underlying service logs/throws mid-request (redaction happens at serialization time, not as a post-hoc log scrub — write a fixture that would leak the raw value if redaction happened anywhere later in the pipeline, and assert it doesn't).
- `apps/api/test/core/audit/audit.e2e-spec.ts`: create/update/delete on Users/Roles produces the expected `audit_log` row with correct old/new values; login/logout produce rows with no diff.
- `apps/api/test/core/audit/purge.e2e-spec.ts`: cutoff = today is rejected (400/422); cutoff = yesterday succeeds; deletes exactly the rows strictly older than cutoff; the purge's own audit row exists afterward with the correct deleted-row count; a second purge with an earlier cutoff than the first is a no-op (no negative counts, no error).

**Done when:** every mutating Phase 1–3 endpoint has an audit test; the schema-scan test passes; the purge boundary tests (today/yesterday) both pass; 80% coverage gate (per `TESTING_STRATEGY.md` §8) is met on `AuditInterceptor` specifically (full CI enforcement is Phase 7, but this phase is where the coverage has to actually exist).

---

### Phase 4 — Notifications (core, mandatory) + full `system_settings` admin surface

**Developer builds**
- `apps/api/src/core/migrations/0006_create_notifications.sql` (`notifications`, `notification_recipients`, §2).
- `prisma/schema.prisma`: add `Notification`, `NotificationRecipient`, `NotificationTargetType`.
- `apps/api/src/core/notifications/`: `NotificationsModule`, `NotificationsService` (`send({ category, title, bodyMarkdown, targetType, targetId, sentBy })` — resolves `role` targets to current holders **at send time**, not a static list, per §12.2), fans out to `notification_recipients` rows + outbound email for categories with email enabled.
- Markdown rendering: a sanitizing renderer (e.g. `marked` + `sanitize-html`) — body is stored as Markdown, rendered to HTML only at display/send time, never stored pre-rendered (per §12.1).
- Email transport: **[PLANNER CALL]** an external SMTP relay via env vars (`SMTP_HOST/PORT/USER/PASS/FROM`), using `nodemailer` — no 4th docker-compose service (keeps exactly `db`/`api`/`web` per D5), with a console/dev-capture transport when no SMTP env vars are set locally. Not specified anywhere in the docs; flag if a different approach (e.g. a hosted email API) is preferred.
- Upgrade `apps/api/src/core/settings/settings.service.ts` (Phase 1 stub) to the full version: in-memory cache invalidated on write, `GET/PUT /settings/password-policy`, `/settings/session-timing`, `/settings/notification-templates` endpoints (`users.settings.view`/`users.settings.update` permissions, per §6.3 — not hardcoded to `admin`).
- Wire `AuthModule`'s forgot-password/force-password-change flow to call `NotificationsService.send(...)` using the `notifications.templates.password_reset` template instead of any earlier stub.
- Seed default templates into `system_settings` (`notifications.templates.password_reset`, `.force_password_change`).

**Tester builds**
- `apps/api/test/core/notifications/notifications.service.spec.ts`: role-target resolution is live (add/remove a role holder mid-test, confirm the next send reflects it), `all_users` fan-out, in-app-only vs email-enabled categories.
- `apps/api/test/core/notifications/notifications.e2e-spec.ts`: send → recipient rows created, unread count correct, mark-as-read; permission matrix for `notifications.send`/`.templates.manage`; confirm `notifications.view` is granted to every base role by default (per §12.4).
- `apps/api/test/core/settings/settings.e2e-spec.ts`: cache invalidates on write (read-after-write consistency across "requests"); permission-gated, not hardcoded to `admin`; every write produces the audit row wired in Phase 3.
- Markdown-rendering test: a malicious admin-authored template (raw `<script>`) is sanitized on render.

**Done when:** a password-reset triggers both an in-app notification and (with SMTP configured) an email using the admin-editable template; all three Settings tabs are readable/writable and cached correctly; every write is audited.

---

### Phase 5 — ModuleRegistry admin flow + I18nModule + `@Public()` mechanism

**Developer builds**
- `apps/api/src/core/module-registry/`: extend the Phase 0 `MigrationRunner` into the full `ModuleRegistryModule` — manifest schema validation (Zod or `class-validator`, shared type in `packages/shared-types`), `compatibleAppVersion`/`dependsOn`/`basePath`+`apiPrefix` collision checks, `locales.supported` includes `ar` check, permission + `defaultRolePermissions` registration (**first install only** — see Phase 8/risks), menu registration (parentId resolves, no cycles), locale-bundle merge, `module_registry.status` transitions, the orchestrated-restart trigger (a real process restart — see risks — not an in-process hot-swap).
- `POST /modules/install`, `/modules/:key/upgrade`, `/modules/:key/uninstall` (`--drop-data` flag support per D26), `GET /modules` — all `modules.*`-permission-gated.
- `apps/api/src/core/i18n/`: `I18nModule` — merges `apps/api` core locale bundle + every `installed` module's `locales/*.json` into one runtime dictionary per language, `GET /i18n/:lang` API for the frontend, fallback chain (active language → `ar` → literal key, per §9).
- `apps/api/src/common/decorators/public.decorator.ts` (`@Public()`), update `JwtAuthGuard` to short-circuit to "no user" (not reject) when present, update `PermissionGuard` to no-op only when both no-user **and** route is `@Public()` — still rejects unauthenticated requests to any non-public endpoint.
- `apps/api/src/common/guards/throttler.guard.ts`: wraps Nest's `ThrottlerGuard`, reads `security.public_endpoint_rate_limit` from `SettingsService` **per request** (not baked into a `forRoot()` call at bootstrap), and is configured for correct client-IP resolution behind the docker network (see risks).
- Update `AuditInterceptor` (Phase 3) to actually set `actorType = 'anonymous'` when the matched route carries `@Public()` metadata and there's no `req.user`; genuine `'system'` rows (e.g. a future scheduled job) are written directly by the calling service, never inferred by the interceptor from an HTTP request that doesn't exist.

**Tester builds**
- `apps/api/test/core/module-registry/lifecycle.integration-spec.ts` (per `TESTING_STRATEGY.md` §7): bad `compatibleAppVersion`/missing `ar` locale/colliding `basePath` all rejected, `module_registry` row left `failed` not `installed`, no partial state; double-install is rejected/idempotent; checksum catches an edited already-applied migration file; upgrade applies only new migrations and does **not** re-apply `defaultRolePermissions` over a manually-altered grant (regression test: alter a grant, upgrade, assert unchanged).
- `apps/api/test/core/i18n/i18n.spec.ts`: merge correctness, fallback chain, a module missing a key falls back to `ar` then to the literal key.
- `apps/api/test/common/public-route.e2e-spec.ts`: using a **fixture** controller (no real module exists yet — Phase 8 supplies the real one) with one `@Public()` route — reachable with no `Authorization` header (200, not 401); a non-public route on the same fixture controller still 401s; `ThrottlerGuard` rejects a burst over the configured per-IP limit with 429 (not silently unlimited); confirm client IP resolves correctly through the docker-compose network topology used in the integration test, not `undefined`/`127.0.0.1` for every request.
- `apps/api/test/core/audit/anonymous-actor.spec.ts`: the fixture public route's audited action writes `actor_type='anonymous'`, `actor_user_id = null`, IP/user-agent captured.

**Done when:** the fixture public route's full test suite passes (this is the only proof point until Phase 8's real module exists — call this out explicitly so the Tester doesn't treat "no real public route yet" as a gap); module install/upgrade/uninstall lifecycle tests all pass; I18n merge/fallback tests pass.

---

### Phase 6 — React shell: MUI RTL, i18n, auth + admin screens

**Developer builds**
- `apps/web/src/app/`: router (React Router), `ThemeProvider` with `direction` driven by active language (`ar`→`rtl` via `stylis-plugin-rtl`, `en`→`ltr`), `react-i18next` bootstrap fetching `GET /i18n/:lang` from Phase 5's `I18nModule`, auth/session context (access token in memory, refresh handled transparently via httpOnly cookie, per §6.1).
- `apps/web/src/shared/`: `PageLayout`, `usePermission(code)`/`<Can permission="...">` (calls the same permission-resolution the backend uses — via a `GET /permissions/me/effective` endpoint added to `PermissionsModule`, cached client-side per session, invalidated on role/grant change notifications), `formatDate`/`formatNumber` (pinned `calendar: 'gregory'`, `numberingSystem: 'latn'` per D6/D7), API client (axios/fetch wrapper).
- `apps/web/src/core/` pages: Login, Force-Password-Change; Users list/CRUD + Excel import UI; Roles CRUD; **Permissions grant-matrix page** (exercises the D12 always-reachable behavior visibly); Sessions "active sessions" view + force-revoke; Audit log viewer + purge screen (cutoff date-picker capped at yesterday, disabled for today); Settings screens (3 tabs, per Phase 4); Notifications bell/inbox + compose/send screen; Modules admin screen (list/install/upgrade/uninstall).
- `apps/web/src/locales/core/{ar,en}.json`.

**Tester builds**
- `apps/web/tests/unit/`: component tests per page (RTL for `usePermission`-gated rendering, matching `FEATURE_TEMPLATE.md` §6's "renders Add button only when `usePermission` returns true" pattern) for every page above.
- `apps/web/tests/unit/i18n-rtl.spec.tsx`: renders one representative page in both `ar` (asserts `dir="rtl"` on root) and `en` (`dir="ltr"`), asserts number/date formatting uses Latin digits + Gregorian calendar in both (per `TESTING_STRATEGY.md` §5).
- `apps/web/tests/e2e/` (Playwright): login flow, force-password-change flow, a `reader` genuinely can't see/reach a `finance`-only page even by direct URL, language switch persists and flips layout direction.
- Locale completeness lint fixture test (script wired into CI in Phase 7): every key in `ar.json` exists in `en.json` and vice versa.

**Done when:** every core admin capability is reachable and permission-gated in the UI; RTL/LTR both verified; Playwright e2e smoke suite green.

---

### Phase 7 — CI

**Developer builds**
- `.github/workflows/ci.yml`: `lint → typecheck → unit → integration (testcontainers) → e2e (backend) → frontend unit → frontend e2e (smoke subset) → manifest/locale lint`, on every push to the single branch (D4/D31), matching `TESTING_STRATEGY.md` §8 exactly. Coverage gate: 80% lines on `PermissionGuard`, `AuditInterceptor`, `AuthModule`, `ModuleRegistryModule` specifically — no blanket global threshold.
- `scripts/lint-permissions.ts`: parses every controller for `@RequirePermission`/`@Audit` codes, cross-checks against every installed module's (+ core's) manifest `permissions` array — fails on any code used but not declared.
- `scripts/lint-locales.ts`: for core + every module, `ar`/`en` key sets must match exactly.
- `scripts/lint-no-hardcoded-roles.ts`: greps for role-name-shaped checks (`role.code ===`, `.roles.includes(`, string literals `'admin'|'reader'|'finance'|'library_assistant'` used in a conditional) outside the single whitelisted file from Phase 2 — fails the build if found anywhere else.

**Tester builds**
- CI dry-run fixtures for each lint script: one "should pass" and one "should fail" sample input per script (these live under `scripts/__fixtures__/`), asserting the scripts' exit codes — since the scripts themselves are the "tests" for everything else, they need their own tests.
- A PR-sized smoke run confirming the full pipeline completes in a reasonable time budget (documented, not hard-gated) so future phases don't silently balloon CI runtime.

**Done when:** a push to the branch runs the full pipeline green end-to-end, including on Phase 0–6's existing code; a deliberately-broken fixture (missing `ar` key, undeclared permission code, a second hardcoded role check) fails the pipeline as expected.

---

### Phase 8 — Library Catalog module (first real installable module)

**Developer builds**
- `modules/library-catalog/manifest.json`, `migrations/001_create_books_table.sql` (+ `002_add_isbn_index.sql`), `backend/` (`library-catalog.module.ts`, `books.controller.ts`, `books.service.ts`), `frontend/` (`routes.tsx`, `pages/BooksListPage.tsx`, `pages/BookDetailPage.tsx`), `locales/{ar,en}.json` — following `FEATURE_TEMPLATE.md`'s worked example exactly (it's written against this exact module).
- **One deliberate public route**, `GET /library/public/books/:id/availability` (`access: "public"` in the manifest, `@Public()` on the controller method, read-only, no `ThrottlerGuard` required for reads per §7.3 but included anyway for consistency since it's cheap) — **[PLANNER CALL]**: MODULE_SPEC's own worked example for this module has no public route, but nothing else in the base build exercises the Phase 5 `@Public()`/`actor_type='anonymous'`/`ThrottlerGuard` mechanism against a real (non-fixture) route, and `TESTING_STRATEGY.md` §6 requires it be tested. This gives that mechanism a genuine end-to-end proof point, matching ARCHITECTURE §1's stated goal of Library Catalog "proving the module system for real."
- Wire `apps/api` tsconfig `include` and `apps/web` vite glob-import config (from Phase 0's layout note) to actually pick up `modules/library-catalog/*` once `module_registry.status = 'installed'`.
- Install the module via the Phase 5 admin flow (manual step or a seed script) as part of getting this phase's tests running.

**Tester builds**
- `modules/library-catalog/**/*.spec.ts`: `BooksService` unit tests.
- Full permission-matrix e2e coverage (`view/create/update/delete/export`) using the Phase 2 helper.
- Audit test: create/update/delete a book produces the expected `audit_log` row.
- The **real** public-route e2e test from `TESTING_STRATEGY.md` §6 against `/library/public/books/:id/availability` — reachable with no `Authorization` header, `audit_log` row (if audited) has `actor_type='anonymous'`/null `actor_user_id`/captured IP-UA, and confirms the `ThrottlerGuard` actually 429s a burst.
- Manifest lint (via Phase 7's `lint-permissions.ts`/`lint-locales.ts`, run against this real module for the first time — the scripts were only fixture-tested before).
- Frontend: `BooksListPage` permission-gated rendering test, i18n completeness for `library_catalog` namespace.

**Done when:** the module installs cleanly through the real admin UI (Phase 6) end-to-end (migrations run, permissions/menu/locales register, restart happens, routes mount on both frontend and backend), every test above passes, and the full CI pipeline (Phase 7) stays green with this module included.

---

## 4. Risks / things a Developer agent might get wrong

1. **Fresh permission resolution, not JWT claims.** The JWT carries `roles` (for the D12 check and UX only) but **never** permissions — `PermissionGuard` must hit `role_permissions` on every single request. The easy-to-miss bug is a per-user in-memory cache that isn't invalidated the instant an admin changes a grant (§7.2 exists specifically so revocation is immediate); don't cache effective permissions across requests, even "briefly."

2. **D12's single hardcoded exception.** Exactly one file (`permissions-page.guard.ts`) may contain a role-name-shaped check. The temptation to add a second one shows up anywhere someone wants "admin should always be able to see X regardless of grants" (e.g. the Modules admin screen) — the answer is always "grant admin the permission by default in the seed, don't hardcode," never a second bypass. `scripts/lint-no-hardcoded-roles.ts` is the backstop, not the primary defense.

3. **`@Sensitive()` redaction must happen at serialization, not at logging.** Since this repo's concrete mechanism is a Prisma DMMF doc-comment lookup consulted by `AuditInterceptor` right before it serializes `oldValue`/`newValue`, the trap is a debug `console.log`/error handler elsewhere in the request pipeline (e.g. a Prisma error dump, a request-logging middleware) printing the raw DTO/entity **before** the interceptor ever runs. Redaction at one point in the pipeline doesn't protect the others — treat any place that serializes a `User`/`UserSession`-shaped object for logs as needing the same sensitive-field check, not just the audit path.

4. **`defaultRolePermissions` only applies on first install.** The install and upgrade code paths must be genuinely different, not "the same idempotent function called twice" — an upgrade that re-runs the default-grant block would silently re-grant permissions an admin deliberately revoked, or clobber a customized grant back to the manifest's default. Gate strictly on the `module_registry.status` transition (`installing → installed` only runs it); the upgrade path inserts new `permissions` rows with **zero** role grants, full stop.

5. **The yesterday-cap on audit purge is a strict inequality, and timezone matters.** "Cutoff capped at yesterday" means reject any `cutoffDate >= today`, evaluated in a single consistent timezone (recommend UTC, since D7 already pins Gregorian everywhere and Arabic locale calendars can be ambiguous) — an off-by-one here (`<=` instead of `<`, or comparing a UTC cutoff against a server-local "today") either lets the buffer day get purged or blocks a legitimate purge. The purge's own audit row must be written **after** the delete completes (not before, and not in the same transaction in a way that could roll back the row along with a failed delete) — the row records actual deleted-row count, not a pre-computed estimate.

6. **`actor_type` nullability rules.** `'user'` always has non-null `actor_user_id`; `'system'` and `'anonymous'` both have null `actor_user_id` but mean different things (`'system'` = no HTTP request context at all, e.g. a future cron — written directly by the triggering service, never by `AuditInterceptor`; `'anonymous'` = a real HTTP request through a `@Public()` route with no authenticated user). The bug to avoid: `AuditInterceptor` defaulting to `actorType = req.user ? 'user' : 'system'` and never producing `'anonymous'` at all, because it forgot to check the route's `@Public()` metadata. Back this with the DB `CHECK` constraint too (defense in depth, not just application logic).

7. **Per-IP throttling on public write routes.** Two independent failure modes: (a) the rate limit value gets hardcoded into a `ThrottlerModule.forRoot({...})` call at bootstrap instead of read from `system_settings` per request via the cached `SettingsService` — silently defeats D34's "admin-tunable" requirement; (b) client IP resolves to the docker bridge/proxy address for every request unless NestJS's trust-proxy / Throttler `getTracker` override is configured correctly for the actual network topology — either every anonymous caller shares one bucket (false 429s) or none are ever throttled (the abuse vector §7.3 exists to prevent). Test this against the real docker-compose network, not just `localhost`.

8. **Two migration systems creeping in.** Because `prisma` ships a `migrate` command that "just works" out of habit, a Developer agent under time pressure may reach for `prisma migrate dev` for a core table instead of writing a raw `.sql` file under `core/migrations/`. This creates a second, untracked migration history (`_prisma_migrations`) alongside `module_migrations`, and the two will drift. Removing `migrate`-family scripts from `package.json` (Phase 0) is the main guardrail; code review is the second.

9. **"Orchestrated restart" means a real process restart, not a hot-swap.** NestJS's DI container is built once at bootstrap; there's no supported way to `import()` a new module into an already-running app and have it participate in existing guards/interceptors/DI graph correctly. Phase 5's install flow must trigger an actual container/process restart (write the registry row **before** triggering it, so a crash mid-restart resumes as "installed, needs mount" rather than losing the record, per MODULE_SPEC.md §4 step 8) — don't try to build a fancier in-process hot-reload; that's explicitly out of scope per the D15 reinterpretation in `DECISIONS.md`.

10. **Excel import upsert precedence (D30 edge case).** D30 says upsert "by ID/email" but doesn't resolve what happens when a row's ID matches one existing user and its email matches a *different* existing user. This plan picked ID-takes-precedence-with-conflict-rejection (§Phase 2) as a deterministic rule so the feature is buildable, but it's a genuine gap in the decided spec — flag to the user for confirmation rather than treating it as settled.
