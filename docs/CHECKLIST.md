# What I need from you before implementation starts

Nothing below blocks reading/reviewing the plan — only actual scaffolding/coding. Items are ordered by how much they'd cost to change later.

## Blocking — architecture-shaping

1. **Confirm the "dynamic install, orchestrated restart" reinterpretation of module loading** (`docs/DECISIONS.md`, the D15 note). You picked full runtime dynamic loading; I'm proposing the realistic version of that for a compiled TS stack (install from the DB/admin UI, no rebuild — but a brief automated backend restart). If a restart on install is truly unacceptable, say so and I'll redesign around the compile-time + DB-activation-flag hybrid instead.
2. **Session registry storage**: PostgreSQL (assumed, A2) vs adding Redis to docker-compose. Postgres keeps infra simpler; Redis is faster/more standard for this exact use case if you expect meaningful concurrent session volume.
3. **Module uninstall data policy** (`MODULE_SPEC.md` §5): default is "safe" — uninstall never silently drops tables/data unless you explicitly confirm `--drop-data`. Confirm that's what you want vs. clean-uninstall-by-default.

## Blocking — scope/content

4. **Language set at launch**: I assumed Arabic + English (A4). Confirm, or give the real list.
5. **Excel user-import column layout** (A7): confirm the fields (name, email, ID, role, department, …) and whether duplicates/updates-via-reimport should be supported on day one.
6. **Password policy specifics** (A5): length/complexity/lockout thresholds — my defaults are in the assumptions log, override if you have requirements (e.g. from an existing IT policy).
7. **Multi-tenancy** (A1): confirm single organization/single tenant is correct — this is expensive to retrofit if wrong.
8. **Email out of scope for base** (A6): confirm admin-driven password reset/set is sufficient for now, i.e. no "forgot password" self-service email flow yet.
9. **Audit log retention** (A8): indefinite/no purge, or a retention window we should design the schema (partitioning) around from day one?

## Non-blocking — nice to pin down early, easy to change later

10. Branding basics: app name (working name is "papp" from the repo — is that final or a placeholder?), primary color, logo (can come later).
11. Deployment target once past local docker-compose: a specific VM/cloud host, or undecided for now?
12. CI provider: GitHub Actions assumed available given this repo's on GitHub — confirm.
13. Access-token lifetime / refresh-token lifetime / idle-timeout / absolute-timeout durations — I'll propose sane defaults (e.g. 15 min access / 30 day refresh / 30 min idle / 12 hour absolute) unless you have specific numbers.

## Process

14. **Review the five docs** in `docs/`: `ARCHITECTURE.md`, `DECISIONS.md`, `MODULE_SPEC.md`, `FEATURE_TEMPLATE.md`, `TESTING_STRATEGY.md`. Flag anything wrong, missing, or over/under-engineered.
15. Once 1–9 are answered (10–13 can trail), I'll scaffold the actual repo: docker-compose, NestJS app with the core modules (Auth, Sessions, Users, Roles, Permissions, Audit, ModuleRegistry, I18n), React app shell with MUI+RTL+i18n wired up, and the base migrations — with the test suite from `TESTING_STRATEGY.md` alongside it from the start, not bolted on after.
16. After the base platform is working end-to-end (you can log in, manage users/roles/permissions, see the audit log, switch language), we build the **first real module** (Library Catalog) as the proof that the module system in `MODULE_SPEC.md` actually works, before adding Borrowing/Finance on top.

## Self-improvement loop (per your ask)

`.claude/skills/papp-add-feature/SKILL.md` and this repo's `CLAUDE.md` are the living memory that keeps future feature work consistent with everything decided here. When you ask for a new feature and I notice the skill/template is missing something (a new pattern, an edge case, a rule that should generalize), I'll propose the specific change to those files and ask you to confirm before it takes effect — I won't silently rewrite the standing rules.
