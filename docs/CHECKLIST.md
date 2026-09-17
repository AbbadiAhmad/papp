# Checklist status

All items from the original checklist are resolved — see `docs/DECISIONS.md` (D20–D33) for the full record of this round. Nothing here blocks starting implementation.

## Resolved this round

1. ✅ Module install trade-off (brief orchestrated restart) — accepted.
2. ✅ Session registry storage — PostgreSQL, no Redis.
3. ✅ Module uninstall data policy — safe-by-default.
4. ✅ Languages at launch — Arabic + English.
5. ✅ Excel import columns + re-import behavior — name/email/ID/role/department, upsert.
6. ✅ Password policy — admin-editable setting, not hardcoded (D23).
7. ✅ Multi-tenancy — single tenant, confirmed.
8. ✅ Email/notifications scope — Notification Center is core & mandatory (D20), in-app + email, targets platform users only (D21), Markdown templates as free-form admin content (D22).
9. ✅ Audit log retention — manual, admin-triggered purge with a cutoff capped at yesterday (D25).
10. ✅ Branding — "papp" is a placeholder for now.
11. ✅ Deployment target — undecided, stays provider-agnostic.
12. ✅ CI — GitHub Actions, part of the base build (D31).
13. ✅ Session/token lifetimes — admin-editable setting, not hardcoded (D24).

## Still open (low-stakes defaults, not blocking)

See `docs/ASSUMPTIONS.md` for the full, current list (A3/A10/A11 as of this writing) — kept in one place rather than duplicated here so it can't drift out of sync with itself.

## Next step

Scaffold the actual repository: docker-compose (`db`, `api`, `web`), NestJS app with the core modules (Auth, Sessions, Users incl. Settings, Roles, Permissions, Audit, Notifications, ModuleRegistry, I18n), React app shell with MUI + RTL + i18n wired up, base Prisma schema + first migrations, GitHub Actions CI, and the test suite from `docs/TESTING_STRATEGY.md` from the start. Then the Library Catalog module, as the first proof of `docs/MODULE_SPEC.md`.

I'll start this once you give the go-ahead (see wrap-up message).
