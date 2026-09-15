# papp — Base Platform Architecture

Status: **planning document, no application code written yet.** See `docs/DECISIONS.md` for the choices behind everything here and `docs/CHECKLIST.md` for what's still open.

## 1. What this phase builds

A modular back-office platform ("papp") with complete user/role/permission management, session security, audit logging, and Arabic-first (RTL) multi-language UI. The **Library Management** feature (books, borrowing/returning, finance) is deliberately **not** part of this phase — it will be the first real module built on top of the platform once the base is agreed and working, proving the module system for real.

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + TypeScript, MUI (Material UI) | RTL via MUI's `direction` theme option; i18n via `react-i18next` |
| Backend API | NestJS (TypeScript) | REST (OpenAPI/Swagger documented) so a future mobile client can consume it |
| Database | PostgreSQL | One DB, module-owned schemas/tables via per-module SQL migrations |
| ORM | Prisma (queries/types) + hand-written SQL migration files per module | See D16 |
| Auth | JWT access token (short-lived) + refresh token (longer-lived, rotated, revocable) | See D18 |
| Session registry | PostgreSQL table (`user_sessions`) | See A2 — swappable for Redis later behind an interface |
| Deployment | docker-compose: `db`, `api`, `web` services | Single Docker host for now (A9) |

## 3. C4 — Level 1: System Context

```
                    ┌───────────────────────────┐
                    │        End User            │
                    │ (Admin / Assistant /        │
                    │  Finance / Reader)          │
                    └──────────────┬──────────────┘
                                   │ HTTPS (browser)
                                   ▼
                    ┌───────────────────────────┐
                    │   papp Web (React SPA)     │
                    └──────────────┬──────────────┘
                                   │ HTTPS/JSON (REST, JWT bearer)
                                   ▼
                    ┌───────────────────────────┐
                    │   papp API (NestJS)        │◄──── (future) Mobile App
                    └──────────────┬──────────────┘
                                   │ SQL
                                   ▼
                    ┌───────────────────────────┐
                    │   PostgreSQL               │
                    └───────────────────────────┘
```

## 4. C4 — Level 2: Containers

```
┌─────────────────────────────────────────────────────────────────┐
│ docker-compose                                                    │
│                                                                     │
│  ┌───────────────┐   ┌────────────────────┐   ┌────────────────┐ │
│  │ web            │   │ api                 │   │ db              │ │
│  │ React SPA      │──▶│ NestJS              │──▶│ PostgreSQL      │ │
│  │ served via     │   │ - REST controllers  │   │ - core schema   │ │
│  │ nginx (static) │   │ - Prisma client     │   │ - per-module    │ │
│  │                │   │ - module registry   │   │   tables        │ │
│  └───────────────┘   │ - job: session sweep │   └────────────────┘ │
│                       └────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

No Redis/queue/email service in this phase (see A2, A6). Adding one later is a docker-compose addition, not an architecture change.

## 5. C4 — Level 3: API components (core, always present)

```
NestJS app
├── AuthModule            — login, refresh, logout, force-password-change
├── SessionsModule         — session registry, "active sessions" admin view, revoke
├── UsersModule            — CRUD, browse, Excel import/export, admin actions, Settings sub-area (§6.4)
├── RolesModule            — role CRUD, assign roles to users
├── PermissionsModule      — permission registry, role↔permission grants, PermissionGuard
├── AuditModule            — AuditInterceptor, audit log query API, admin-triggered purge (§8.4)
├── NotificationsModule    — core, mandatory (D20): in-app notifications + outbound email (§12)
├── ModuleRegistryModule   — install/upgrade/uninstall modules, manifest validation
├── I18nModule             — merges core + per-module locale bundles, language switch API
└── <feature modules>      — installed dynamically at runtime (see MODULE_SPEC.md)
```

Each **core** module above is itself permission-gated the same way a feature module would be (see §7) — the base platform doesn't get special-cased application logic, only the Permissions page gets a special-cased **access rule** (§7.4).

## 6. Security & sessions

### 6.1 Auth flow (JWT access + refresh, D18)

1. `POST /auth/login` — validates credentials, checks lockout state (policy from `system_settings`, §6.4), issues:
   - **Access token** (JWT, short-lived — default 15 min, admin-configurable via `system_settings`, D24): carries `sub` (user id), `roles`, `sid` (session id). Permissions are **not** embedded in the token (they'd go stale the instant an admin changes a grant); `PermissionGuard` always resolves the caller's effective permissions fresh from `role_permissions` on each request.
   - **Refresh token** (opaque random string, long-lived — default 30 days, admin-configurable): stored **hashed** in `user_sessions`, returned to the client as an httpOnly, `Secure`, `SameSite=Strict` cookie (web) — never exposed to JS.
2. `user_sessions` row captures: `session_id`, `user_id`, `refresh_token_hash`, `issued_at`, `last_active_at`, `expires_at`, `ip_address`, `user_agent`, `geo_location` (from IP lookup, A3), `revoked_at`.
3. Every authenticated request updates `last_active_at` on that session (throttled, not literally every request, to avoid write amplification).
4. `POST /auth/refresh` — rotates the refresh token (old one invalidated, prevents replay), issues a new access token. Refresh reuse (an already-rotated token presented again) revokes the whole session chain — signals possible token theft.
5. `POST /auth/logout` — revokes the current session.
6. Admin "Active Sessions" screen (Users module) lists all sessions per user (or system-wide) with IP/location/last-active, and can force-revoke any of them (forced logout) — this satisfies "see active users, last login, IP address."
7. Absolute session timeout **and** idle timeout are both enforced (two separate durations, both admin-configurable via `system_settings`, D24) — satisfies "considering active session time."

### 6.2 Password handling

- Hashing: Argon2id (or bcrypt if we standardize on what NestJS ecosystem defaults to — open item, low stakes).
- Admin can: set a user's password directly, and/or force "must change password at next login" (a `must_change_password` flag checked at login, redirects to a mandatory change-password screen before anything else is reachable).
- Passwords, password hashes, and raw tokens are **never** written to the audit log (D13 exclusion) — enforced structurally, not by convention (§8.3).
- Complexity/length rules and failed-login lockout threshold/duration are **not hardcoded** — read from `system_settings` (D23), with sane pre-filled defaults (min 10 chars, one letter + one number, 5 failed attempts → 15 min lockout) that the admin can change from the Users module's Settings screen. A settings change takes effect on the next login attempt (in-flight sessions are unaffected until they re-authenticate).

### 6.3 `system_settings` (D22/D23/D24)

```
system_settings(key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_by UUID, updated_at TIMESTAMPTZ)
```

Holds, at minimum: `auth.password_policy`, `auth.token_lifetimes` (access/refresh/idle/absolute), and `notifications.templates.*` (D22, see §12.3). Read through a small cached settings service (invalidated on write) rather than passed around as raw config, so every consumer (`AuthModule`, `SessionsModule`, `NotificationsModule`) always sees the current value without a restart. Every write to `system_settings` goes through the normal `@Audit(...)` path like any other update — a policy change is itself an accountable action.

Exposed to admins from a **Users module → Settings** screen (tabs: Password Policy, Session Timing, Notification Templates), permission-gated like anything else (`users.settings.view` / `users.settings.update`) — not hardcoded to `admin` (§7.4 stays the only hardcoded-role exception in the codebase).

## 7. Roles & permissions (RBAC)

### 7.1 Data model (core)

```
roles(id, code, name_i18n_key, is_system)          -- admin, library_assistant, finance, reader + future custom roles
permissions(id, code, module_key, category, description_i18n_key)   -- e.g. "users.create", "library.books.delete"
role_permissions(role_id, permission_id)             -- the grant table admins edit
user_roles(user_id, role_id)                         -- many-to-many: a user can hold multiple roles
```

A user's **effective permission set** = union of permissions granted to every role they hold. No explicit per-user "deny" overrides in this phase (keeps the model simple and auditable) — flagged as an open item if you want per-user exceptions later.

### 7.2 Enforcement pattern

Every protected endpoint declares the permission(s) it needs via a decorator; a global `PermissionGuard` reads the caller's effective permissions (resolved from `sid`/`sub` in the JWT, looked up fresh — not just trusted from token claims, to make revocation immediate) and allows/denies before the handler runs. See `docs/FEATURE_TEMPLATE.md` for the exact decorator/guard pattern new features must follow.

Frontend mirrors this with a `usePermission('code')` hook/`<Can permission="...">` component that hides/disables UI — this is a UX convenience only; **the backend guard is the actual security boundary**, never the frontend check alone.

### 7.3 Permission catalog is data-driven

Permissions are **registered by each module's manifest** (core platform registers its own: `users.*`, `roles.*`, `permissions.*`, `sessions.*`, `audit.*`) into the `permissions` table at install time, with a **default grant** per base role also declared in the manifest (e.g. `reader` gets nothing from the Users module by default). Admins then adjust grants per role from the Permissions page. See `docs/MODULE_SPEC.md` §"permissions".

### 7.4 The one hard-coded exception

Rule D12 ("admin can always reach the Permissions page regardless of grants") is implemented as a single, explicit, code-reviewed bypass: the Permissions page's guard checks `role.code === 'admin'` **in addition to** the normal permission check (`OR`, not instead of). This is the **only** place in the codebase allowed to special-case a role by name — documented here so it's never "reinvented" elsewhere by accident. Every other page/action/API must go through the normal permission table with no hardcoded role checks. This rule is also encoded in the AI-agent skill (`.claude/skills/papp-add-feature/SKILL.md`) so future generated code doesn't add new hardcoded role checks.

## 8. Audit logging

### 8.1 Data model

```
audit_log(
  id, occurred_at, actor_user_id, actor_session_id,
  category,            -- e.g. "auth", "user_management", "permissions", "library.books"
  entity_type,          -- e.g. "User", "Role", "Book"
  entity_id,
  action,               -- "login", "create", "update", "delete", "permission_grant", ...
  old_value  jsonb,      -- null on create
  new_value  jsonb,      -- null on delete
  ip_address, user_agent
)
```

`category` is always the owning module's key (`core.users`, `library.books`, …) so the audit screen can filter by module — this is what "the entity of the entry should be categorized" means in the data model.

### 8.2 How entries get created

A single `AuditInterceptor` (NestJS interceptor, applied globally, opt-out not opt-in) diffs the before/after state of any request that a controller has tagged with `@Audit({ category, entityType, action })` and writes the row. Login/logout events are written directly by `AuthModule` (no "before" state to diff).

### 8.3 Secret redaction (structural, not convention)

A field-level `@Sensitive()` marker (used on the Prisma model fields for `passwordHash`, token fields, etc.) is checked by the interceptor's diffing function **before** it ever serializes old/new values — sensitive fields are stripped to `"[redacted]"` at the serialization layer itself, so a developer forgetting to think about it can't accidentally leak a hash into the log. This is enforced by a unit test that scans the Prisma schema for known-sensitive field name patterns and asserts they're all marked (see `docs/TESTING_STRATEGY.md`).

### 8.4 Manual purge (D25)

No automatic retention job. Instead, an admin-only screen (`audit.purge` permission) in Audit settings lets the admin pick a **cutoff date**, capped at **yesterday** (the UI/API rejects any cutoff ≥ today — you can never purge the most recent day's entries, so there's always at least one full day of buffer to catch a mistake before it's unrecoverable). Confirming the purge deletes every `audit_log` row with `occurred_at < cutoff`. The purge action itself writes a **new** `audit_log` row (category `core.audit`, action `purge`) recording the actor, the cutoff date, and the number of rows deleted — this one entry is written *after* the delete completes, so it survives and the purge is never itself untraceable.

## 9. Internationalization & RTL

- Library: `react-i18next` (or `@nestjs/i18n` mirror on the backend for server-generated strings like email subjects/validation messages).
- **Per-module localization (D19):** every module ships `locales/<lang>.json` files namespaced under its module key (e.g. `library.books.title`). The `I18nModule` merges: `core/<lang>.json` + every installed module's `<lang>.json` into one runtime dictionary per language, keyed by namespace so modules can't collide. A key missing in the active language falls back to the app's configured default language (D_A4: Arabic), then to the literal key (visibly broken, so it's easy to spot in QA rather than silently showing English).
- Module manifests declare which languages they ship (§`MODULE_SPEC.md`); the module registry validates that **every** module supports at minimum the base app's default language before allowing install — a module can't ship without Arabic strings.
- RTL: MUI's `ThemeProvider` direction is driven by the active language's directionality metadata (`ar` → `rtl`, `en` → `ltr`). This affects: text alignment, the whole layout mirroring (nav drawer flips side, icons like back/forward arrows flip, form label/input order), not just text alignment — MUI's `rtl` plugin (stylis-plugin-rtl) handles this automatically for MUI components; any custom CSS we write must be written with logical properties (`margin-inline-start` not `margin-left`) to stay RTL-safe. This rule is in the AI-agent skill.
- Numerals stay Western Arabic (0-9) in all languages (D6) — do **not** let `Intl.NumberFormat('ar')` silently switch to Eastern Arabic-Indic digits; the number-formatting utility pins `numberingSystem: 'latn'` explicitly.
- Dates: Gregorian everywhere (D7); `Intl.DateTimeFormat` pinned to `calendar: 'gregory'` for the same reason (`ar` locale can default to other calendars in some environments).

## 10. Module system

Full spec in `docs/MODULE_SPEC.md`. Summary: each feature (Library, Borrowing, Finance…) is a self-contained package with a `manifest.json` describing its DB migrations, menu entries, permissions + default role grants, locale files, frontend routes/landing page, and backend module. It is installed/upgraded/uninstalled from an admin "Modules" screen; install triggers migrations + registry writes + an orchestrated backend restart (see D15 reinterpretation in `DECISIONS.md`).

## 12. Notification Center (D20 — core, mandatory)

Unlike every other feature module, Notifications ships as a **core** capability (`NotificationsModule`) alongside Users/Roles/Permissions/Audit — not built through the module-manifest system, and never uninstallable. It's core because `AuthModule`'s password-reset/force-change flow and any future system alert depend on it always being present.

### 12.1 Two delivery channels, one event

```
notifications(
  id, created_at, category,          -- e.g. "auth.password_reset", "system.announcement"
  title, body_markdown,               -- rendered to HTML at display/send time, never stored pre-rendered
  sent_by UUID,                       -- null for system-generated (e.g. password reset)
  target_type,                        -- "user" | "role" | "all_users"  (D21 — never an arbitrary external address)
  target_id                           -- user_id or role_id, null when target_type = 'all_users'
)
notification_recipients(notification_id, user_id, read_at, emailed_at)
```

A single "send" action fans out to both channels: an `notification_recipients` row per targeted user (drives the in-app bell icon / unread count, D_orig "user in website notification"), and — if the notification's category has email enabled — an outbound email using the matching template (§12.3).

### 12.2 Targeting (D21)

`target_type = 'user'` (a specific person), `'role'` (everyone currently holding a role, resolved at send time — not a static list), or `'all_users'` ("public" in your original wording). All three resolve only to existing platform accounts; there is no free-text external email field, keeping this consistent with D21 and sidestepping open-relay/abuse concerns entirely.

### 12.3 Templates are content, not code (D22)

Templates (forgot-password, force-password-change notice, future ones) are rows in `system_settings` (§6.3) under keys like `notifications.templates.password_reset`, each holding `{ subject, body_markdown }`. The admin edits this from **Users module → Settings → Notification Templates** as a single free-form field per template — Markdown source, written in whatever language the admin chooses (no per-locale key structure like UI strings have; this is operator-authored content, not developer-authored UI copy, so D19's per-module locale-file system does not apply here). At send time, `body_markdown` is rendered to HTML (a standard sanitizing Markdown renderer — no raw HTML injection from an admin-authored template) for the email channel and rendered as-is (or lightly rendered) for the in-app view.

### 12.4 Permissions

`notifications.send` (compose/send to a target), `notifications.templates.manage` (edit templates, effectively `users.settings.update` from §6.3), `notifications.view` (see your own in-app notifications — granted to every role by default, since everyone needs to see notices meant for them).

## 13. Module system

Full spec in `docs/MODULE_SPEC.md`. Summary: each **feature** (Library, Borrowing, Finance…) — as opposed to core capabilities like Notifications above — is a self-contained package with a `manifest.json` describing its DB migrations, menu entries, permissions + default role grants, locale files, frontend routes/landing page, and backend module. It is installed/upgraded/uninstalled from an admin "Modules" screen; install triggers migrations + registry writes + an orchestrated backend restart (D15 in `DECISIONS.md`).

## 14. Non-goals for this phase

- Mobile/desktop native clients (API is designed to support them later, not built now).
- Multi-tenancy (D29).
- Kubernetes/multi-host orchestration (D33 — deployment target undecided but provider-agnostic).
- Per-user permission overrides beyond role-based grants (§7.1 note).
- Free-text external email recipients for notifications (D21 — platform users only).
