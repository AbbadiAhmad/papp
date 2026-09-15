# papp — project memory

Modular back-office platform: complete user/role/permission management + audit logging + Arabic-first (RTL) multi-language UI as the base, with Library Management (books, borrowing/returning, finance) as the first real module built on top.

**Current status: planning phase.** No application code has been written yet — only the planning documents in `docs/` and this memory file. Do not scaffold the actual NestJS/React app until the user has confirmed the blocking items in `docs/CHECKLIST.md`.

## Read these before touching anything in this repo

- `docs/ARCHITECTURE.md` — system architecture (C4-style), security/session design, RBAC, audit logging, i18n/RTL.
- `docs/DECISIONS.md` — every architectural decision and assumption, with status. **Append new entries here for any new architectural choice; never silently edit an old one.**
- `docs/MODULE_SPEC.md` — the module manifest spec (Odoo/Gibbon-style), install/upgrade/uninstall flow.
- `docs/FEATURE_TEMPLATE.md` — worked example of how a feature page/endpoint/manifest entry/tests must be built.
- `docs/TESTING_STRATEGY.md` — test tooling and the required permission-matrix/audit/i18n test patterns.
- `docs/CHECKLIST.md` — open items awaiting the user's decision; check before assuming something is settled.
- `.claude/skills/papp-add-feature/SKILL.md` — the enforceable checklist version of the above; **invoke this skill whenever adding or changing a feature.**

## Stack (once implementation starts)

React + TypeScript + MUI (RTL via theme direction) · NestJS (TypeScript) · PostgreSQL · Prisma for queries/types with per-module raw SQL migrations · JWT access + refresh tokens with a Postgres-backed revocable session registry · docker-compose (`db`, `api`, `web`) · single git branch.

## Non-negotiable rules (see SKILL.md for the full checklist)

1. Every action is permission-gated by a permission **code**, never a hardcoded role name — the one exception (Permissions page always reachable by `admin`) is documented in `ARCHITECTURE.md` §7.4 and must never be duplicated elsewhere.
2. Every create/update/delete is audit-logged with old/new values, except fields marked `@Sensitive()` (passwords, tokens, hashes).
3. Every module ships its own `ar` + confirmed-language locale files (D19) — a module without Arabic strings fails install validation.
4. Numerals: Western Arabic digits (0-9) everywhere, even in Arabic UI (D6). Calendar: Gregorian everywhere (D7). Both are pinned explicitly in the shared format utilities, never left to locale defaults.
5. New features follow `docs/FEATURE_TEMPLATE.md` exactly: manifest permission entry → guard decorator → audit decorator → locale keys in every language → tests (permission matrix + audit + i18n completeness).

## Working with the user

- Do not silently make architectural decisions where a real alternative exists — use `AskUserQuestion` or otherwise surface the options, the way `docs/DECISIONS.md` records past ones.
- Flag assumptions explicitly (see the Assumptions table in `DECISIONS.md`) rather than guessing quietly.
- When a new feature request reveals a gap or needed change in the skill/template/docs, propose the specific edit and get confirmation before it becomes standing guidance for future work.
