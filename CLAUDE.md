# papp — project memory

Modular back-office platform: complete user/role/permission management + audit logging + Arabic-first (RTL) multi-language UI as the base, with Library Management (books, borrowing/returning, finance) as the first real module built on top.

**Current status: implemented.** The core platform (`apps/api`, `apps/web`, `packages/shared-types`) and the installable modules in `modules/` (`library_catalog`, `library_circulation`, `reading_club`, `survey`, `website`, plus `template`) are built; `docs/BUILD_PLAN.md` records the phases and `docs/DECISIONS.md` the decisions made along the way (check its last entries for the latest). Still check `docs/CHECKLIST.md` for items awaiting the user's decision before assuming something is settled.

Local checks: `npm run build` (builds `shared-types` first, then every workspace), `npm run lint`, `npm run lint:manifests`, `npm run typecheck --workspace=@papp/web` (builds `shared-types` first — other workspaces import it, so type-checking without that build fails). Run `npm install --workspaces --include-workspace-root` first on a fresh checkout.

## Read these before touching anything in this repo

- `docs/ARCHITECTURE.md` — system architecture (C4-style), security/session design, RBAC, audit logging, i18n/RTL.
- `docs/DECISIONS.md` — every architectural decision, with status. **Append new entries here for any new architectural choice; never silently edit an old one.**
- `docs/ASSUMPTIONS.md` — standing assumptions not yet explicitly confirmed by you; check before assuming something here is actually settled.
- `docs/MODULE_SPEC.md` — the module manifest spec (Odoo/Gibbon-style), install/upgrade/uninstall flow. §9 also covers each module's own `DOCUMENTATION.md`/`DECISIONS.md`.
- `docs/FEATURE_TEMPLATE.md` — worked example of how a feature page/endpoint/manifest entry/tests must be built.
- `docs/TESTING_STRATEGY.md` — test tooling and the required permission-matrix/audit/i18n test patterns.
- `docs/CHECKLIST.md` — open items awaiting the user's decision; check before assuming something is settled.
- `.claude/skills/papp-add-feature/SKILL.md` — the enforceable checklist version of the above; **invoke this skill whenever adding or changing a feature.**

## Stack

React + TypeScript + MUI (RTL via theme direction) · NestJS (TypeScript) · PostgreSQL · Prisma for queries/types with per-module raw SQL migrations · JWT access + refresh tokens with a Postgres-backed revocable session registry · docker-compose (`db`, `api`, `web`) · single git branch · GitHub Actions CI (D31).

Core (always installed, never uninstallable): Auth, Sessions, Users (incl. Settings: password policy, session/token lifetimes, notification templates), Roles, Permissions, Audit, **Notifications** (in-app + email, D20), ModuleRegistry, I18n. Everything else (Library Catalog, Borrowing, Finance, …) is an installable module per `docs/MODULE_SPEC.md`.

## Non-negotiable rules (see SKILL.md for the full checklist)

1. Every action is permission-gated by a permission **code**, never a hardcoded role name — the one exception (structurally protecting `permissions.view`/`permissions.grant` from ever being revoked from the `admin` role) is documented in `ARCHITECTURE.md` §7.4 and must never be duplicated elsewhere.
2. Every create/update/delete is audit-logged with old/new values, except fields marked `@Sensitive()` (passwords, tokens, hashes). Audit entries are only ever removed via the manual, admin-triggered purge with a cutoff capped at yesterday (`ARCHITECTURE.md` §8.4) — never a silent/automatic delete.
3. Every module ships its own `ar` + confirmed-language locale files (D19) — a module without Arabic strings fails install validation. (Notification templates are the one exception — operator-authored content in `system_settings`, not developer i18n keys, per D22.)
4. Numerals: Western Arabic digits (0-9) everywhere, even in Arabic UI (D6). Calendar: Gregorian everywhere (D7). Both are pinned explicitly in the shared format utilities, never left to locale defaults.
5. New features follow `docs/FEATURE_TEMPLATE.md` exactly: manifest permission entry → guard decorator → audit decorator → locale keys in every language → tests (permission matrix + audit + i18n completeness).
6. Password policy and session/token lifetimes are **never** hardcoded constants — they're read from `system_settings` (`ARCHITECTURE.md` §6.3) through the cached settings service, same pattern any future admin-tunable policy should follow.

## Working with the user

- Do not silently make architectural decisions where a real alternative exists — use `AskUserQuestion` or otherwise surface the options, the way `docs/DECISIONS.md` records past ones.
- Flag assumptions explicitly (see `docs/ASSUMPTIONS.md`) rather than guessing quietly.
- When a new feature request reveals a gap or needed change in the skill/template/docs, propose the specific edit and get confirmation before it becomes standing guidance for future work.
