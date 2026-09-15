# Decisions & Assumptions Log (papp)

Status values: `DECIDED` (you chose it), `PROPOSED` (my recommendation, awaiting your confirmation), `ASSUMED` (I picked a sensible default because it wasn't specified — flag if wrong).

This log is append-only going forward: new architectural choices get a new numbered entry, never a silent edit of an old one.

## Confirmed by you

| # | Decision | Status |
|---|---|---|
| D1 | Frontend: React (with TypeScript) | DECIDED |
| D2 | Backend: NestJS (TypeScript) | DECIDED |
| D3 | Database: PostgreSQL | DECIDED |
| D4 | Single git branch for all work | DECIDED |
| D5 | docker-compose covers DB, backend, frontend | DECIDED |
| D6 | Numerals: Western Arabic digits (0,1,2,3…), **not** Eastern Arabic-Indic (٠١٢٣) | DECIDED |
| D7 | Calendar: Gregorian (not Hijri) | DECIDED |
| D8 | Default language: Arabic, RTL. Multi-language support required. | DECIDED |
| D9 | Roles at launch: `admin`, `library_assistant`, `finance`, `reader` | DECIDED |
| D10 | Sessions are session-based, tracking active time, token, IP, location | DECIDED |
| D11 | Every action is permission-gated per role; permissions are grantable/revokable per role | DECIDED |
| D12 | Admin always has access to the Permissions page, regardless of its own permission grants | DECIDED |
| D13 | Full audit log (login, create/update/delete) with old/new values, entity-categorized, **except** secrets (passwords, tokens) | DECIDED |
| D14 | Web browser only for now; API must be secure/stable enough for a future mobile client | DECIDED |
| D15 | Module loading strategy: **runtime dynamic plugin loading** (Odoo/Gibbon-style — modules can be installed/enabled without a full rebuild) | DECIDED |
| D16 | ORM: **Prisma for app code**, but each module ships its **own raw SQL migration files** (not one global Prisma migration history) | DECIDED |
| D17 | UI library: **MUI (Material UI)** | DECIDED |
| D18 | Auth model: **JWT access token + refresh token**, with a server-side revocable registry for the "active sessions" admin view | DECIDED |
| D19 | Each module ships its **own localization files** (one JSON/YAML bundle per supported language, namespaced under the module key) — not just core. Missing keys fall back to the language's default namespace, then to the base app's default language. | DECIDED |

## D15 reinterpretation — confirmed

You confirmed "dynamic install, orchestrated restart": installing a module from the admin UI runs its DB migrations + registers menus/permissions/routes immediately, then triggers a brief automated, health-checked backend restart so the new NestJS module actually mounts. No manual redeploy/rebuild step is needed to install a module — only the short restart. `MODULE_SPEC.md` is written around this. (Full rationale for why literal zero-downtime hot code swap isn't realistic in compiled TypeScript is preserved in git history of this file.)

## Checklist round — resolved (2026-09-15)

| # | Decision | Status |
|---|---|---|
| D20 | **Notification Center is a core, mandatory capability** (not an optional module) — lives alongside Users/Roles/Permissions/Audit, always installed, can never be uninstalled. Covers in-app (website) notifications and outbound email. Auth's forgot-password/system emails depend on it. | DECIDED |
| D21 | "Public" notification/email sends reach **platform users only** (all users, or a filtered subset by role) — never arbitrary external addresses not tied to an account. | DECIDED |
| D22 | Notification/email **templates** (forgot-password and others) are admin-editable content: **one content field per template**, written in **Markdown**, and the admin can write it in **any language** they choose (freeform — not structured per-locale like UI i18n keys). Managed from the Users module's settings area. | DECIDED |
| D23 | **Password policy is not hardcoded.** Minimum length, complexity rules, and failed-login lockout threshold/duration are admin-editable settings in the Users module (with sane defaults pre-filled), not fixed constants. | DECIDED |
| D24 | **Session/token lifetimes are not hardcoded either** — access-token lifetime, refresh-token lifetime, idle timeout, and absolute session timeout are all admin-editable settings in the Users module, same pattern as D23. | DECIDED |
| D25 | **Audit log purge is manual, admin-triggered, in log settings**: admin picks a cutoff date (capped at yesterday — today's/very recent entries can never be purged) and everything strictly older than that cutoff is deleted. No automatic/scheduled retention job. The purge action is itself audit-logged (actor, cutoff date, row count deleted). | DECIDED |
| D26 | Module **uninstall is safe-by-default**: menus/routes/permissions are de-registered immediately, but database tables/data are left in place unless the admin explicitly confirms a separate "also delete data" step. | DECIDED |
| D27 | Session/refresh-token registry confirmed in **PostgreSQL** (no Redis for now). | DECIDED |
| D28 | Languages at launch confirmed: **Arabic (default, RTL) + English (LTR)**. | DECIDED |
| D29 | **Single tenant** confirmed — no multi-tenancy, no `tenant_id` anywhere in the schema. | DECIDED |
| D30 | Excel user import columns: **name, email, ID (national/employee), role, department**. Re-importing the same file **upserts** — matches existing users by ID/email and updates their fields rather than skipping them. | DECIDED |
| D31 | **GitHub Actions CI** set up as part of the base platform build (lint/typecheck/unit/e2e per `TESTING_STRATEGY.md`, running on every push to the single branch). | DECIDED |
| D32 | App name **"papp" is a placeholder** — used consistently for now (package names, UI title) but expected to be renamed later; low-cost to change. | DECIDED |
| D33 | Deployment target beyond local docker-compose is **undecided** — design stays provider-agnostic (plain docker-compose, no provider-specific assumptions baked in). | DECIDED |

### New design consequence of D22/D23/D24 — a `system_settings` concept

D22–D24 together mean the Users module needs a **Settings** sub-area, not just user/role CRUD: a small `system_settings` table (key, value `jsonb`, `updated_by`, `updated_at`) holding password policy, session/token lifetimes, and notification templates, editable from an admin screen, read by `AuthModule`/`SessionsModule`/`NotificationsModule` at runtime (cached, invalidated on change) instead of reading fixed config constants. Changes to these settings go through the normal audit log like any other update. This is reflected in `ARCHITECTURE.md` §6 and §12 (Notification Center).

## Public/shareable routes (added after you raised the survey-link example)

| # | Decision | Status |
|---|---|---|
| D34 | Modules can declare individual routes as `"access": "public"` in their manifest (`MODULE_SPEC.md` §2/§7) — reachable with no login, dynamic ID segments included (e.g. `/survey/:surveyId`). Backend pairs this with a `@Public()` decorator that the existing `JwtAuthGuard`/`PermissionGuard` explicitly recognize (guards stay applied everywhere, no bypassed endpoints) rather than an ad-hoc unguarded controller. Public **write** endpoints must use the shared, admin-tunable `ThrottlerGuard` (`system_settings` key `security.public_endpoint_rate_limit`) as an abuse-mitigation baseline. `audit_log` gains an `actor_type` (`user`/`system`/`anonymous`) column so anonymous actions stay traceable by IP/user-agent. | DECIDED |

This generalizes the very first requirement's "default page (public or restricted with hooks)" line into a concrete, reusable mechanism rather than leaving it implicit.

## Build-time constraints discovered during Phase 0 (2026-09-15)

| # | Decision | Status |
|---|---|---|
| D35 | **Prisma pinned to `^6.19.3`, not the newest `7.x`.** Prisma 7 removes the classic `datasource { url }` pattern in `schema.prisma` in favor of driver adapters + a separate `prisma.config.ts` — a real architectural change, not a patch bump. Prisma 6 is the newest version still compatible with the "hand-maintained `schema.prisma`, generate-only, raw-SQL migrations" approach this plan is built around (D16, `BUILD_PLAN.md` §1). Revisit deliberately if/when moving to Prisma 7 is wanted — it's real work, not a version-bump housekeeping task. | DECIDED (Developer agent call, Phase 0) |
| D36 | **TypeScript pinned to `^6.0.3`, not the newest `7.x`.** `typescript-eslint` 8.70.0 (current) requires `typescript >=4.8.4 <6.1.0`; a newer TS would break the lint toolchain. Revisit once `typescript-eslint` supports TS 7. | DECIDED (Developer agent call, Phase 0) |

## Assumptions still standing (flag any that are wrong)

| # | Assumption | Why |
|---|---|---|
| A3 | "Location" for session tracking = IP-based geolocation (city/country via IP lookup), not GPS/browser geolocation | This is a web back-office app; browser geolocation would require explicit user permission prompts and isn't standard for this use case. Not yet explicitly confirmed by you. |
| A10 | Backend also exposes OpenAPI/Swagger docs (auto-generated from NestJS decorators) since the API must support a future mobile client | Reasonable default for an API meant to be consumed by another client later; costs little. Not yet explicitly confirmed by you. |

(A1, A2, A4–A9 from the original list are now superseded by D20–D33 above and removed from this table to avoid duplication.)

## Open items still needing your decision

None blocking implementation start. A3 and A10 above are low-stakes defaults you can override any time without rework.
