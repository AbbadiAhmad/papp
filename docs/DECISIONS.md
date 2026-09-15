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

## My reinterpretation of D15 — please confirm

You picked "runtime dynamic plugin loading" (the most Odoo-like option) over compile-time registration. I want to be upfront about what's realistically achievable in a **compiled TypeScript** stack before we build on it:

- **True hot in-memory code swap** (add a module's backend code to a running Node process with zero restart, like PHP/Odoo's Python does) is not practical or safe in NestJS. Compiled TS + Node's module cache make that a research project, not an engineering task, and it would be the least tested, hardest-to-secure part of the whole platform.
- What **is** realistic and still gives you the Odoo/Gibbon experience you want (install a module from an admin screen, no manual redeploy/rebuild step) is:
  1. A module is a self-contained package dropped into a `modules/` directory (or published as a private npm package and installed there).
  2. "Install" from the admin UI: the platform runs the module's SQL migrations, registers its menus/permissions/routes into the database, marks it `installed`, then triggers an **automated, orchestrated restart** of the backend container (docker-compose managed, health-checked, sub-few-seconds) so the new NestJS module is mounted. The frontend uses lazy-loaded route bundles (dynamic `import()`, optionally Webpack Module Federation later) so new module UI can often be picked up without a full frontend redeploy.
  3. No code rebuild/CI pipeline run is required to install a module — that's the part that matters for your workflow. A brief, automatic backend restart is the trade-off.
- This is what I'll call **"dynamic install, orchestrated restart"** going forward. It gets you: install/upgrade/uninstall from the DB-driven module registry, per-module manifests, no manual redeploy — everything in your ask except literal zero-downtime hot code swap.

**I need your confirmation on this before I design `MODULE_SPEC.md` around it** — see `docs/CHECKLIST.md` item 1. If a few seconds of backend restart on module install is unacceptable, tell me and I'll redesign around the "Hybrid: compile-time code, DB-driven activation" option instead (all module code ships in every build; a DB flag turns it on/off — genuinely zero-downtime, but a module's *code* still needs a normal deploy to arrive).

## Assumptions (flag any that are wrong)

| # | Assumption | Why |
|---|---|---|
| A1 | Single tenant (one library system, one organization) — no multi-tenancy | Not mentioned; multi-tenancy changes the DB schema significantly (tenant_id everywhere) so I'm not assuming it silently — see checklist. |
| A2 | Session/refresh-token registry lives in **PostgreSQL**, not Redis | You didn't confirm Redis, and docker-compose was scoped to "DB, backend, frontend" (3 services). Postgres-backed sessions are slightly slower than Redis at scale but avoid an extra infra dependency. Easy to swap later — the session service will be written behind an interface. |
| A3 | "Location" for session tracking = IP-based geolocation (city/country via IP lookup), not GPS/browser geolocation | This is a web back-office app; browser geolocation would require explicit user permission prompts and isn't standard for this use case. |
| A4 | Languages at launch: Arabic (default, RTL) + English (LTR) | You said "multi-language, default Arabic" but didn't list the full set. Arabic+English is the minimum to prove the i18n/RTL system actually works in both directions. Additional languages are just new translation files, not architecture changes. |
| A5 | Password policy: min 10 chars, at least one letter + one number, no forced periodic expiry (but admin can force a change at any time), 5 failed attempts → temporary lockout | Industry-reasonable default; not specified by you. |
| A6 | Email sending (password reset links, notifications) is **out of scope for the base platform** — admin sets/resets passwords directly instead | Not mentioned in your requirements; adding it means an SMTP/email-provider dependency and templates. Easy to add as a module later. |
| A7 | Excel import for users expects a fixed column template (name, email, national/employee ID, role, department) that we define and document, with a downloadable sample file | You mentioned import but not the exact columns/format. |
| A8 | Audit log retention: indefinite, queryable/filterable by admin, no automatic purge | You didn't specify a retention policy; log tables are append-only and can be large — worth deciding early since deletion strategy affects the schema (partitioning). |
| A9 | Hosting/deployment target for now is a single Docker host (docker-compose), not Kubernetes | Matches your docker-compose requirement; can be re-platformed later without app-code changes if containers stay stateless. |
| A10 | Backend also exposes OpenAPI/Swagger docs (auto-generated from NestJS decorators) since the API must support a future mobile client | Reasonable default for an API meant to be consumed by another client later; costs little. |

## Open items still needing your decision

See `docs/CHECKLIST.md` — these are blocking before implementation starts.
