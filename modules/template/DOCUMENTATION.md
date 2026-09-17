# Template module — documentation

Read `docs/MODULE_SPEC.md` §9 for what this file and `DECISIONS.md` are for, and §10 for this module's specific purpose (it's the copy-me starting point for a new module, not a real feature). Read `DECISIONS.md` in this same directory too.

## Purpose

A real, installable module whose only job is to be copied. It deliberately exercises **every** `manifest.json` option `docs/MODULE_SPEC.md` §2 defines — permissions, `defaultRolePermissions`, `roleAccessPolicy`/`roleAccessLocked`, a `settings` entry, a nested `menu`, an authenticated route AND a public one — backed by one deliberately simple entity (`Items`) so the plumbing is what's on display, not domain complexity.

## Data model

```
template_items(id, title, description, status ENUM(active|archived),
  owner_user_id -> users(id), created_at, updated_at)
```

That's the whole schema. Real Postgres `ENUM` for `status` (not `TEXT` + `CHECK`) because Prisma's `enum` mapping requires it — see `library_catalog`/`survey`'s own `DECISIONS.md` for where that lesson was first learned the hard way.

## Permissions

| Code | Gates |
|---|---|
| `template.items.view` | List/get an item |
| `template.items.create` | Create an item |
| `template.items.update` | Edit an item |
| `template.items.delete` | Delete an item |
| `template.settings.view` | Read the `template.defaults` setting |
| `template.settings.update` | Change the `template.defaults` setting |

`defaultRolePermissions`: `admin` gets all 6; `reader` gets `template.items.view` only (a realistic partial grant, not just "empty like the others"); `library_assistant`/`finance` get none. `roleAccessLocked: {"finance": true}` is also set — **but this is currently inert everywhere in the codebase, not enforced** (see root `docs/DECISIONS.md` D70). It's here to show the correct manifest *shape*, not to claim it does something today.

## Routes

Backend (`apiPrefix: /api/template`):
- `GET/POST /items`, `GET/PATCH/DELETE /items/:id` — `ItemsController`, permission-gated as above, `@Audit`'ed on every mutation.
- `GET /public/items/:id` — `PublicItemsController`, `@Public()` + `PublicThrottlerGuard`. Returns the item's `{id, title, description}` (never `ownerUserId`) **only if `status === 'active'`** — an archived or missing item both 404 identically (MODULE_SPEC.md §7.2: never let an anonymous caller distinguish "doesn't exist" from "exists but not visible").
- `GET/PUT /settings/defaults` — `SettingsController`, the module's own minimal settings surface (see Known gotchas — this exists because the generic core one described in `MODULE_SPEC.md` §8.3 doesn't actually exist, root `D71`).

Frontend (`basePath: /template`):
- `/template/items` (authenticated, `items.view`) → `TemplateItemsListPage.tsx` — list, create/edit dialog, delete, and the settings panel (gated separately by `template.settings.view`/`.update`).
- `/template/public/items/:itemId` (**public**) → `TemplatePublicItemPage.tsx`.

## Key files

- `backend/items.service.ts` — CRUD + `getPublicIfActive` (the public route's actual access rule) + `readDefaultStatus` (reads the `template.defaults` setting directly off `system_settings` via this module's own Prisma client — no separate settings store, `MODULE_SPEC.md` §8.2).
- `backend/settings.service.ts` — the module's own minimal settings read/write; its docblock explains exactly why this exists instead of a generic core endpoint. Copy this file only if your module actually needs an editable setting — most won't.
- `backend/platform.ts` — copy this file **verbatim** as the very first thing when starting a new module from this scaffold; see its own docblock.
- `frontend/pages/TemplateItemsListPage.tsx` — the list + inline settings panel; `DefaultsPanel` inside it is the frontend half of the settings demonstration.
- `test/backend/items.service.spec.ts` — this module's OWN unit spec, per `docs/MODULE_SPEC.md` §9.4 (root D76): a module's tests live inside the module, at `test/backend/` (Jest unit/e2e) and `test/frontend/` (Vitest component tests) — never under `apps/api/test/` or `apps/web/tests/`. Copy this file's shape (the D57 `(service as unknown as {prisma}).prisma = mockPrisma` reflection idiom) as the starting point for your own module's unit specs. This module has no `test/frontend/` example of its own — its pages all need `Router`/`i18n` context to render; see `modules/website/test/frontend/website-safe-markdown.test.tsx` for a real, self-contained frontend test example instead.

## Known gotchas

- **An MUI `TextField` needs its own `label` prop to have a real accessible label — a sibling `<Typography>` next to it does NOT count**, even though it *looks* labeled to a sighted user. Found the hard way: a first draft of `DefaultsPanel`'s status `<TextField select>` had no `label` prop (just a `<Typography>` heading beside it) — it rendered and worked by mouse/click, but had no accessible name at all, which a real Playwright `getByLabel(...)` walkthrough caught immediately (and a screen reader user would have hit for real). Fixed by moving the text into the `TextField`'s own `label` prop. Give every form control a real `label`/`aria-label` from the start, not a nearby heading.
- **`roleAccessLocked` and the module-settings UI are both real gaps, not bugs in this module** — see Permissions above and root `docs/DECISIONS.md` D70/D71. Don't "fix" them locally in a copy of this module; they're platform-wide.
- **`readDefaultStatus`/`SettingsService` read `system_settings` with a plain `findUnique`, no caching** — fine for a template and for a setting read only on create; a module reading its own settings on every request of a hot path should add a cache the way core's own `SettingsService` does.

## How to extend / how to copy this as a new module

This IS the "how to extend" instructions, since the whole point of this module is being copied (`docs/MODULE_SPEC.md` §10 has the short version too):

1. Copy `modules/template/` to `modules/<your_key>/`.
2. Grep case-insensitively for `template` inside the copy and replace every hit: the manifest `key`, permission codes, table/column prefixes, route paths, class names, locale keys, `apps/web/src/App.tsx`'s import + route mounting, `apps/web/src/shared/components/PageLayout.tsx`'s menu entry. There is no rename script.
3. Replace `TemplateItem`/`Items` with your real entity: rewrite the migration, mirror it into `apps/api/prisma/schema.prisma`, rewrite the DTOs/service/controllers with your real fields.
4. Delete whichever demonstrated options you don't need — most modules won't need a `settings` entry or a public route. Keep the ones you DO need shaped exactly like this module shows them (that shape has been verified end-to-end: real install, real curl/browser walkthrough, a unit test, and a Playwright e2e spec).
5. Replace this file and `DECISIONS.md` with your own real module's docs from the start (`docs/MODULE_SPEC.md` §9.3) — don't ship a real module with this placeholder content still in place.
