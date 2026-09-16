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

## Testing sequencing (2026-09-15, during multi-agent build)

| # | Decision | Status |
|---|---|---|
| D37 | **Test investment is tiered and sequenced, not uniform across every phase.** Tier 1 (fast, mocked-dependency unit tests + static lint checks, no Docker/DB/browser) is written continuously through Phases 1–8. Tier 2 (Testcontainers integration tests, full Supertest e2e, the permission-matrix multi-role sweep, Playwright browser e2e, CI coverage-gate enforcement) is deferred to a new dedicated `BUILD_PLAN.md` Phase 9 ("Test hardening"), run once against real CI Docker access rather than repeatedly fought against this dev sandbox's Docker restriction. Per-phase acceptance during Phases 1–8 substitutes a manual/scripted smoke verification for full e2e. Full rationale and tier definitions in `TESTING_STRATEGY.md` §0. | DECIDED |

## Librarian input on the future Library module (2026-09-15)

The librarian (the actual future end user) gave detailed non-technical requirements for the Library module — captured in full in `docs/LIBRARY_MODULE_REQUIREMENTS.md`. This is domain input for Phase 8+, not something being built now. Two platform-level architecture requests came with it, plus several gaps/open questions the domain input surfaced:

| # | Decision/gap | Status |
|---|---|---|
| D38 | **"Roles and permissions defined by every module's manifest" — already satisfied, no change needed.** Confirmed: `MODULE_SPEC.md` §2 already has modules declare their own `permissions` + `defaultRolePermissions`, exactly like GibbonEdu. | CONFIRMED, no action |
| D39 | **"Settings defined within the module (Odoo-style)" — was a real gap, now closed.** Added a `settings` array to the module manifest (`MODULE_SPEC.md` §2/§8): a module declares its own admin-editable `system_settings` keys (namespaced `<moduleKey>.<name>`), seeded with defaults on first install only (same clobber-avoidance rule as `defaultRolePermissions`), rendered generically in the core Settings screen. Directly motivated by the librarian's request for admin-editable `loan_period_days`/`fine_per_day`/`max_books_per_student` (`LIBRARY_MODULE_REQUIREMENTS.md` §8). | DECIDED |
| D40 | "Platform should be flexible to host multiple modules, not necessarily the library" — reaffirms the existing design goal (`ARCHITECTURE.md` §1); no architecture change, just a standing constraint to keep honoring as Library-specific requirements come in (nothing library-specific should leak into core). | CONFIRMED, no action |

### Open questions — resolved by the user (2026-09-15)

| # | Decision | Status |
|---|---|---|
| D41 | **Students/patrons ARE platform Users holding the `reader` role — same login-capable account model as everyone else, not a separate entity.** Users (of any eventual role, `reader` included) can be created either by a permitted user (admin/staff, as already designed) **or by self-registration**, gated by a new admin-editable setting (`users.allow_self_registration`, default `false`) in the Users module settings. This is a genuinely new capability beyond what Phases 1-4 already built — implemented in **Phase 5** as `POST /auth/register` (`@Public()`, `reader` role auto-assigned, throttled like any public write endpoint per D34/§7.3) once the `@Public()` mechanism exists; see `BUILD_PLAN.md` Phase 5. Supersedes Q1's "separate lightweight entity" framing entirely. | DECIDED |
| D42 | **Excel-import preview + per-row error reporting is added now, in Phase 2 — kept deliberately simple, not generalized into a shared framework yet.** `POST /users/import/preview` validates without writing; `POST /users/import` re-validates and commits **all-or-nothing** in one transaction (one bad row blocks the whole file, superseding the earlier "skip bad rows" framing). Generalizing this into a reusable framework for future modules (Library's five entity types) is deferred until a second real consumer needs it — not built speculatively now. See `BUILD_PLAN.md` Phase 2. | DECIDED |
| D43 | **Generic backup/restore is deferred — added later as its own base-platform feature**, not built now and not assumed satisfied by per-entity Excel export alone. No phase assigned yet; revisit once the base platform + first real modules are stable. | DECIDED (deferred) |
| D44 | **Library domain splits into two modules, not three**: `library_catalog` (books/copies) stands alone; `library_circulation` (borrowing/returning, scanning, students/staff domain specifics) and `library_finance` (fines/transactions/payments/receipts) are combined into **one** module, `dependsOn: ["library_catalog"]` — it cannot be installed before its prerequisite, per the existing `dependsOn` validation already in `MODULE_SPEC.md` §4 (no new mechanism needed). `BUILD_PLAN.md` Phase 8 remains scoped to `library_catalog` only, as already planned; the combined circulation+finance module is future work beyond Phase 8/9, not yet numbered. | DECIDED |

### Assumptions made in interpreting the domain input (flag if wrong)

| # | Assumption | Why |
|---|---|---|
| A11 | "RLS" in the librarian's security list (§36) means strict role-based access control at the API layer (already provided by `PermissionGuard`), not literal PostgreSQL Row-Level-Security policies. | The platform is single-tenant (D29) with no per-row multi-tenant isolation need; literal DB-level RLS would be new infrastructure with no clear use case under that constraint. Override if literal RLS was actually intended. |
| A12 | "Staff" (supervisors/teachers) in the domain input are the same as platform Users holding the `library_assistant` role — not a separate non-login entity like the students question above. | Unlike students, the input describes staff actively using the scan screen/app themselves, which requires login — consistent with the existing role model. |

## Phase 2 build decisions (2026-09-15, Developer agent calls — accepted by orchestrator, awaiting your review)

| # | Decision | Status |
|---|---|---|
| D45 | **Role codes are never embedded in the JWT** — the access token stays exactly `{sub, sid}`. The D12 admin check (`PermissionsPageGuard`) resolves role codes fresh from the DB per request, same as effective permissions. More consistent with §7.2's "never trust from token," keeps Phase 1's token contract (and its tests) untouched; cost is one extra indexed join on the two grants-endpoint routes only. Supersedes BUILD_PLAN.md Phase 2's literal "add a `roles` claim" wording; ARCHITECTURE.md §6.1 updated to match. | DECIDED (agent call) |
| D46 | **Each phase seeds only its own permission codes** — Phase 2 seeded the 17 codes whose enforcement points exist (`users.*`, `roles.*`, `permissions.*`, `sessions.*`); `audit.*`/`notifications.*`/`modules.*` are seeded by Phases 3/4/5's own migrations when their controllers arrive, exactly like a module registering permissions at install time. No dangling catalog rows for endpoints that don't exist yet. | DECIDED (agent call) |
| D47 | **Self-scoped `/me` endpoints (`GET /users/me`, `GET /sessions/me`) carry no permission code** — they return only the caller's own data and must stay reachable by every role (a default `reader` holds zero user-management grants; gating `/users/me` behind `users.view` would lock users out of their own account view). `PermissionGuard` passes any undecorated handler through once authenticated, by design. | DECIDED (agent call) |
| A13 | Excel user-import assigns the row's role **additively** (adds it to `user_roles` without removing other roles the user already holds) — not a full role-replace sync. Flag if you'd rather re-import fully replace a user's roles. | ASSUMED |
| A14 | Default role→permission grant matrix seeded in Phase 2: `admin` = all 17, `library_assistant` = `users.view` only, `finance`/`reader` = none of the user-management set. First-cut defaults, freely adjustable from the Permissions page. | ASSUMED |
| A15 | (Phase 3) Self-service `forcePasswordChange` is **not** audited — the audit spec listed login/logout for auth. A "password_changed" row (values fully redacted) can be added if wanted; flag if so. | ASSUMED |
| A16 | (Phase 3) Login/logout audit rows are written by `AuthController` rather than `AuthService`, and `SettingsService` takes its audit writer as `@Optional()` — both forced by Phase 1's untouchable unit-test signatures; behavior per spec either way. The Phase 1 specs should be modernized in a later test pass (noted for Phase 9). | ASSUMED |
| A17 | (Phase 3) Audit-purge accepts impossible-but-well-formed dates (e.g. `2026-02-30`) via JS Date rollover (→ Mar 2) — still safely capped at yesterday, and the contract is pinned by a test so any future "fix" to strict calendar validation is deliberate, not accidental. | ASSUMED |

## Phase 5 build decisions (2026-09-16, Developer agent calls — accepted by orchestrator, awaiting your review)

| # | Decision | Status |
|---|---|---|
| D48 | **Module `--drop-data` uninstall runs `modules/<key>/migrations/down/*.sql` in reverse order if present, else leaves data tables in place with a logged warning.** `MODULE_SPEC.md` §5 specified the *behavior* ("drop-data confirmation runs a down migration set if present") but not the file convention — this `migrations/down/` folder convention is the concrete mechanism. Update `MODULE_SPEC.md` §5 to name it explicitly if you're happy with it. | DECIDED (agent call) |
| D49 | **Self-registration's admin toggle (`users.allow_self_registration`) is gated by the existing `users.settings.view`/`users.settings.update` permission codes**, not a new dedicated code — it's one more boolean on the Users-module settings surface, same shape as password policy/session timing. | DECIDED (agent call) |
| A18 | **`GET /health` needed `@Public()`** — a real regression the global-guard switch introduced (docker-compose's own container healthcheck would otherwise 401 and the container would be marked unhealthy). Found and fixed via live testing during this phase, not a hypothetical. | ASSUMED (fixed) |
| A19 | The module-registry's reserved core `basePath`/`apiPrefix` collision list is a hardcoded backstop (core routes aren't manifest-declared, so can't be cross-checked automatically). `apiPrefix` reservations are authoritative (real controller prefixes); `frontend.basePath` reservations are a best guess since Phase 6 hasn't fixed the SPA's route names yet — revisit once Phase 6 lands. | ASSUMED |
| A20 | (found by Phase 5 Tester) `packages/shared-types/src/module-manifest.ts`'s doc-comment claims the Zod schema itself enforces "`ar` must be in `locales.supported`" (D19), but the schema only checks non-empty — the real enforcement is in `ModuleRegistryService.validateAgainstPlatform`. Not a functional bug (the check happens, just one layer later than the comment implies) — a doc-comment cleanup, not a behavior change. Low priority; note for whoever next touches that file. | ASSUMED (cosmetic) |

## Backend fixes from Phase 6's real-browser verification (2026-09-16)

Phase 6's Developer agent (frontend only, correctly did not touch `apps/api/**`) found three real backend issues via actual browser testing and reported them rather than working around them silently. The orchestrator applied the fixes directly (small, precisely-diagnosed, no new agent needed) and reverified build/lint/237 unit tests plus a live re-check of each fix.

| # | Decision | Status |
|---|---|---|
| D50 | **CORS now echoes an explicit allowlisted origin (`WEB_ORIGIN` env var, comma-separated) instead of the `cors` package's wildcard default.** `credentials: true` with `Access-Control-Allow-Origin: *` is silently rejected by every real browser — the whole cookie-based refresh flow was broken cross-origin (which is every real deployment: dev server↔api port, or prod nginx↔api container). Defaults to `http://localhost:5173` when unset. Documented in `.env.example`. | DECIDED (fix applied) |
| D51 | **`GET /users/me` now carries `@AllowMustChangePassword()`**, a narrow third exception to that decorator (previously only `logout`/`force-password-change`). Without it, a `mustChangePassword=true` user's frontend — whose only way to *learn* that flag is this same endpoint — entered an infinite 403-retry loop, found via real browser testing (hundreds of repeated requests). Reading your own profile leaks nothing the password-change flow needs hidden. | DECIDED (fix applied) |
| D52 | **D12's `PermissionsPageGuard` delegation widened from the grants sub-resource alone to also cover `GET /permissions` and `GET /roles`** (the catalog listings the Permissions page's matrix is built from). Without this, a zero-grant admin could edit grants per the original D12 exception but couldn't see the catalogs needed to render the matrix in the first place — verified live (deleted all 28 of admin's `role_permissions`, confirmed `GET /roles`/`GET /permissions`/the grants endpoint all still 200 while `GET /users` correctly stayed 403, then restored the grants). This does **not** add a second hardcoded role-check file — `permissions-page.guard.ts` remains the only one — it only widens which routes may delegate to that one already-sanctioned guard; behavior for every non-admin caller is unchanged. | DECIDED (fix applied) |
| A21 | Not fixed (deferred, low priority): no `GET /roles/:id/users` ("members of a role") endpoint exists — the frontend's role-assignment dialog does one `GET /roles/user/:userId` call per user instead, which the Phase 6 agent judged fine at current scale. Add the real endpoint if role membership lists become a performance concern. | ASSUMED (deferred) |
| A22 | **No `GET /permissions/me/effective` endpoint exists**, so `apps/web/src/shared/permissions.tsx`'s `usePermission`/`runGated` learn deniability only from a real API call's actual 403 — never a precomputed/cached permission set. This is functionally correct and secure (the backend is always the real boundary either way) but is a UX rough edge: a control a user can't use stays visible until their first click fails, instead of being hidden upfront. Recommended follow-up, not urgent: add that endpoint (cheap — it's the same `getEffectivePermissionCodes` query `PermissionGuard` already runs, just exposed as a read) and switch the frontend to fetch-once-and-cache. Not built now to keep Phase 6 scoped to what the committed backend actually supports. | ASSUMED (deferred) |

## Phase 7 build decisions (2026-09-16)

| # | Decision | Status |
|---|---|---|
| D53 | **CI's coverage gate is wired as a real, enforced, currently-RED job** (`backend-coverage-gate`), not softened to match today's numbers: `PermissionGuard` 100%, `AuditInterceptor` 97.5%, `auth.service.ts` 97.6% all clear the 80% line bar; `auth.controller.ts` is **0%** (only exercised by the deferred Tier 2 e2e layer, no Tier 1 unit tests target the controller directly) and `module-registry.service.ts` is **71.34%** (short ~9 points — mostly install/upgrade error-path branches). The threshold is left at the real target per D37's spirit (never fake a gate to make it pass) — closing the gap is tracked as a follow-up (see next entry) rather than merged silently red. | DECIDED |
| D54 | Playwright's `no tests found` for zero specs is a **real exit-1 failure**, not a benign no-op as BUILD_PLAN.md's Phase 7 text assumed — confirmed empirically against the installed `@playwright/test@1.63.0`. CI's frontend-e2e job uses `--pass-with-no-tests` explicitly until Phase 9 adds real specs. | DECIDED (correction to BUILD_PLAN assumption) |

## Phase 8 build decisions — real constraints every future module must follow (2026-09-16)

Phase 8 (`library_catalog`, the first real installed module) surfaced genuine, load-bearing constraints on how *any* module must be packaged — not quirks of this one module. The Zod manifest schema itself needed zero changes; all the friction was in the runtime-loading layer. Recorded here (and mirrored into `MODULE_SPEC.md`) so the next module (the future combined `library_circulation`+`library_finance` module, D44) doesn't rediscover these the hard way.

| # | Decision | Status |
|---|---|---|
| D55 | **A module's on-disk directory name must equal its manifest `key` literally** (`modules/library_catalog/`, snake_case — not the hyphenated `modules/library-catalog/` shown as an illustrative example in `MODULE_SPEC.md` §1/`BUILD_PLAN.md`). `ModuleRegistryService`/`module-loader.ts` both build the filesystem path from the literal key string. `MODULE_SPEC.md` §1's illustrative path corrected to match. | DECIDED |
| D56 | **`manifest.json`'s `backend.entry` must point to compiled CommonJS output (`backend/library-catalog.module.js`), never a raw `.ts` file** — confirmed empirically that plain Node cannot `import()` NestJS-decorated TypeScript even with type-stripping. Each module therefore ships **both** its TypeScript source and that source's own compiled output, checked into git together, via a small module-owned `tsconfig.json` that compiles in place (extending the shared base config). This is a real, permanent packaging requirement for every future module, not a one-off — mirrored into `MODULE_SPEC.md` §1. | DECIDED |
| D57 | **A module cannot directly import `apps/api/src/common/**`'s real decorators/guards** (`@Public()`, `@RequirePermission()`, `@Audit()`, `@CurrentUser()`, `MustChangePasswordGuard`) — only `apps/api/dist/**` (built output) exists as loadable JS at runtime, and a raw relative import across that boundary doesn't resolve for a dynamically-loaded module. **Until a shared `@papp/platform-kit` package exists**, every module ships a small local file (`backend/platform.ts` in this module) that re-declares these as thin `SetMetadata`/`createParamDecorator` shims against the **exact same literal metadata key strings** the real global guards read (`isPublic`, `requiredPermission`, `auditMetadata`, `allowMustChangePassword` — verified byte-for-byte identical during review). This is a plugin-contract, not a reimplementation of any actual security/audit logic — the real enforcement still runs entirely inside core's global guards/interceptor, which apply to every controller including dynamically-mounted ones automatically. **Real, standing maintenance cost**: if core ever renames one of these keys, every module's shim must be updated in lockstep, silently, with no compiler error to catch a miss (a plain string mismatch, not a type mismatch). `PublicThrottlerGuard` is the one exception — modules import the REAL class from `apps/api/dist/...` rather than reimplementing it, since it's genuine shared logic (an admin-tunable rate limiter), not a metadata marker. Building the `@papp/platform-kit` package is recommended before a second module is built, to remove this drift risk. | DECIDED |
| A23 | **`apps/api/Dockerfile` does not yet copy `modules/` into the runtime image or compile them as part of the image build** — a real module installs and mounts correctly in this dev/local-Postgres setup, but as committed today would be invisible in an actual `docker-compose up` deployment (the container only ships `apps/api/dist`). Real, pre-existing infra gap surfaced by having a real module to test against for the first time — not introduced by this module, not fixed here (outside the 9-phase build/test scope; a Dockerfile change is real infra work, not test hardening). Needs: `COPY modules modules` + invoking each module's own `tsconfig.json` during the image build. | ASSUMED (deferred) |
| A24 | **The frontend menu (`PageLayout.tsx`) and route table (`App.tsx`) are still static, hand-edited arrays** — not yet driven from the `module_menu_entries` table `ModuleRegistryService` already populates at install time. Every future module needs the same manual addition to both files until a generic renderer is built (matching BUILD_PLAN.md Phase 8's own acknowledgment that no dynamic-mounting UI was in scope yet). Not urgent while there's only one real module; worth building before a third module makes the manual pattern painful. | ASSUMED (deferred) |

## Critical fix — the build was broken in real CI the whole time (2026-09-16)

Checking Phase 7's actual CI runs (now that real CI exists) showed every run since Phase 7 landed had **failed at the very first job** (`Build / typecheck`), skipping everything downstream — invisible from inside this sandbox because a long-lived local checkout's stale `node_modules`/`packages/shared-types/dist` papered over it. Reproduced with a genuine clean-room test (`npm ci` after clearing `node_modules` and `dist`) before fixing, and reverified the same way after.

| # | Decision | Status |
|---|---|---|
| D58 | **Root cause, two compounding bugs**: (1) `apps/api/tsconfig.json` overrode `baseUrl` to its own directory, which silently broke the `@papp/shared-types` path-alias inherited from `tsconfig.base.json` (TypeScript resolves inherited `paths` relative to whichever `baseUrl` is actually in effect) — a fresh checkout has no fallback since `packages/shared-types` isn't built yet at that point. (2) Even after fixing that, resolving the alias to `packages/shared-types/src/*.ts` (real TS source) pulled a file outside `apps/api`'s declared `rootDir` into the compile, a hard `TS6059` under `declaration`/emit — the same rootDir constraint the Phase 8 agent independently discovered for modules. **Fix**: `apps/api/tsconfig.json` sets `"paths": {}` (cancels the inherited source-alias entirely, forcing real node_modules package resolution) and the root `build` script now builds `@papp/shared-types` explicitly before the rest of the workspaces — needed for both type-checking (its `dist/index.d.ts` must exist) and actual runtime (`apps/api/dist/**/*.js` keeps the bare `require('@papp/shared-types')` specifier verbatim; TypeScript never rewrites import paths, so the running process needs the same real, built package a source-only alias could never have satisfied anyway). Verified: a from-scratch `npm ci` + `npm run build` + `npm run test:unit` + all three lint scripts all pass cleanly with no stale local state. | DECIDED (critical fix) |
| A25 | This is a strong argument for periodically validating the repo with a **genuinely clean checkout** (a fresh clone, or `git clean -xdf` equivalent) rather than trusting a long-lived sandbox's accumulated `node_modules`/build output — real CI is the actual authority on this, not local runs. Worth keeping in mind for the rest of Phase 9 and beyond: a local "it builds" is necessary but not sufficient. | ASSUMED (process note) |
| D59 | **Phase 9's flagship `library-catalog.e2e-spec.ts` could not even load its module graph, in real CI's Node 22 as much as locally**: `public.controller.ts` imports the real `PublicThrottlerGuard` from `apps/api/dist/common/guards/public-throttler.guard.js` (D57's deliberate exception — genuine shared rate-limiter logic, not a metadata shim). That file is `tsc`-compiled CommonJS (`require('@nestjs/common')`), but `@nestjs/common` 12 ships ESM-only; jest-runtime's own CJS `require()` only gained `require(esm)` support on Node 24.9+, and this repo targets Node 22 (`ci.yml`'s `NODE_VERSION: '22'`) — so the exact same failure reproduces in real CI, not just this sandbox. Every other NestJS import in the suite avoids this because `.ts` files compile to real ESM (`useESM: true`) and load through Jest's native `--experimental-vm-modules` loader, which has no such version floor. **Fix**: `apps/api/test/jest.e2e.config.ts` gets a test-only `moduleNameMapper` entry redirecting the exact `.../apps/api/dist/common/guards/public-throttler.guard` specifier to the real `.ts` source (`src/common/guards/public-throttler.guard.ts`) — the same file `AppModule` already loads elsewhere in the same test run, so Jest's module cache gives every test exactly one guard class. This mirrors the existing `@papp/shared-types` → TS-source `moduleNameMapper` entry already in `jest.base.config.ts` (test-only source redirect, real dist import untouched for actual dev/production processes, which run on real Node 22.12+ with native `require(esm)` and never hit this). Verified: the isolated no-DB diagnostic test in that spec file now passes, and the full `jest.e2e.config.ts`/`jest.integration.config.ts` runs fail in exactly the expected `Could not find a working container runtime strategy` (Docker-blocked) mode across every suite, with zero other error types. | DECIDED |
| A26 | **`test/support/permission-matrix.ts` (repo root, per `BUILD_PLAN.md`'s Phase 0/2 plan) sits outside every npm workspace**, so it has no `eslint.config.*` coverage and `npm run lint` (which only runs `--workspaces`) never lints it — real, pre-existing structural gap in where CI's lint job reaches, not introduced by Phase 9. Typechecking still covers it (`apps/api/tsconfig.test.json` includes it via the e2e specs' relative imports, confirmed clean via `tsc --noEmit`). Left as-is rather than relocating it into `apps/api/test/support/` unilaterally, since its repo-root location was an explicit, documented placement from the earliest planning pass (`BUILD_PLAN.md` Phase 0/2), not an accident — flagging for your review rather than silently moving it. | ASSUMED (deferred) |



## Assumptions still standing (flag any that are wrong)

| # | Assumption | Why |
|---|---|---|
| A3 | "Location" for session tracking = IP-based geolocation (city/country via IP lookup), not GPS/browser geolocation | This is a web back-office app; browser geolocation would require explicit user permission prompts and isn't standard for this use case. Not yet explicitly confirmed by you. |
| A10 | Backend also exposes OpenAPI/Swagger docs (auto-generated from NestJS decorators) since the API must support a future mobile client | Reasonable default for an API meant to be consumed by another client later; costs little. Not yet explicitly confirmed by you. |

(A1, A2, A4–A9 from the original list are now superseded by D20–D33 above and removed from this table to avoid duplication.)

## Open items still needing your decision

None blocking implementation start. A3 and A10 above are low-stakes defaults you can override any time without rework.
