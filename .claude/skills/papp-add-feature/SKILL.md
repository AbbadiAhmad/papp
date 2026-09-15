---
name: papp-add-feature
description: Use whenever adding or modifying a feature/page/endpoint/module in the papp platform (React + NestJS + PostgreSQL library-management platform). Enforces the permission, audit, i18n/RTL, and module-manifest conventions defined in docs/ so every feature stays consistent regardless of which agent or session built it.
---

# Adding a feature to papp — required pattern

Read these first if not already in context: `docs/ARCHITECTURE.md`, `docs/MODULE_SPEC.md`, `docs/FEATURE_TEMPLATE.md`, `docs/DECISIONS.md`. This skill is the enforceable checklist version of those docs — when in doubt, the docs are the source of truth and this skill should be updated to match, not the other way around.

## Before writing any code

1. Is this a **core platform** capability (users/roles/permissions/sessions/audit/i18n infrastructure itself) or a **module** capability (Library Catalog, Borrowing, Finance, or any future domain feature)? Modules never modify core tables directly; core never depends on a module.
2. Does the target module already exist? If yes, add to its manifest. If no, scaffold a new module folder per `docs/MODULE_SPEC.md` §1 (`manifest.json`, `migrations/`, `backend/`, `frontend/`, `locales/`) before writing the feature itself.

## Every new endpoint must have

- [ ] A permission code declared in the module's `manifest.json` `permissions` array (never invent a code inline only in the controller).
- [ ] `@RequirePermission('<code>')` on the controller method (or class, if the whole controller shares one gate) — via `PermissionGuard`, applied alongside `JwtAuthGuard`. No endpoint is ever permission-check-free, including read-only ones, unless it's genuinely public (must be called out explicitly and justified — public endpoints are rare and reviewed carefully).
- [ ] `@Audit({ category, entityType, action })` on every create/update/delete endpoint. Read endpoints only get it if they expose another user's sensitive data.
- [ ] A `defaultRolePermissions` entry in the manifest for every base role (`admin`, `library_assistant`, `finance`, `reader`), even if the value is an empty array — explicit "no access" beats an implicit gap.
- [ ] **Never** a hardcoded role-name check (`user.role === 'admin'`, `roles.includes('finance')`, etc.) anywhere in feature/module code. The **only** exception in the entire codebase is the Permissions page's own guard, per `docs/ARCHITECTURE.md` §7.4 — if you think you need a second one, stop and raise it with the user instead of adding it.
- [ ] A permission-matrix e2e test per `docs/TESTING_STRATEGY.md` §2 covering all four base roles + anonymous.

## Every new field that touches secrets

- [ ] Marked `@Sensitive()` at the Prisma field level (passwords, tokens, hashes, anything that shouldn't appear in the audit log). Verify the schema-scan test in `docs/TESTING_STRATEGY.md` §3 still passes.

## Every new admin-tunable policy/threshold

- [ ] Stored as a key in `system_settings` (`docs/ARCHITECTURE.md` §6.3) and read through the cached settings service — never a hardcoded constant, `.env` value, or magic number in code. Password policy and session/token lifetimes already follow this (D23/D24); any new one (a future notification-sending limit, an import batch size, etc.) should too unless there's a specific reason not to — raise it with the user if unsure.

## Every new UI page

- [ ] Copy goes through `t('module_key.namespace.key')`, never hardcoded strings, in **both** `locales/ar.json` and `locales/en.json` (or the full confirmed language set — check `docs/CHECKLIST.md` item 4 for the current answer) at the same time. A key added to one language file without the other fails the locale-completeness lint.
- [ ] Uses MUI components / logical CSS properties only — no `margin-left`/`text-align: left` literals that would break under RTL. Sanity-check the page renders correctly in both `ar` (RTL) and `en` (LTR) before calling it done.
- [ ] Dates and numbers go through the shared `formatDate`/`formatNumber` utilities (pinned Gregorian calendar, Latin/Western digits per D6/D7) — never a raw `toLocaleDateString()`/`toLocaleString()` call.
- [ ] Gates its actions with `usePermission('<code>')`/`<Can permission="...">`, matching exactly the backend permission code for that action — this is a UX nicety, the backend guard is what actually enforces it, but they must never drift apart.

## Every new/changed module manifest

- [ ] `compatibleAppVersion` set to a sane semver range.
- [ ] `migrations` are additive, filename-ordered, never edited once applied (checksum-tracked) — a change to already-shipped behavior is a new migration file, not an edit to an old one.
- [ ] `menu` entries have a valid `parentId` (or `null`) and a `requiredPermission`.
- [ ] `roleAccessLocked` is used only when a role must **never** be grantable this module's permissions under any circumstance — this is rare; default is that admin can grant anything to any role.

## If you find yourself wanting to deviate from any rule above

Stop and ask the user rather than quietly doing something different — these rules exist specifically so that features built across different sessions/agents stay consistent. If a rule genuinely doesn't fit a new situation, propose the specific edit to this file (and the relevant `docs/*.md`) for the user to confirm, per the self-improvement process in `docs/CHECKLIST.md`.
