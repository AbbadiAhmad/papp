# Website module — documentation

Read `docs/MODULE_SPEC.md` §9 for what this file and `DECISIONS.md` are for and when to update them. Read `DECISIONS.md` in this same directory too — this file is the current shape, that one is why it's shaped that way.

## Purpose

A much-simpler-than-Odoo public site builder: an admin composes pages out of a fixed set of block types, arranges header/footer menus, and publishes — visitors reach the result under `/site/*` with no login at all. Everything else about the public site is deliberately out of scope (see "Known gotchas" below).

## Data model

```
website_pages(id, slug UNIQUE, title, status TEXT CHECK(draft|published), is_homepage BOOLEAN, created_at, updated_at)
  -- partial unique index: at most one row can have is_homepage = true
website_blocks(
  id, page_id -> website_pages(id) ON DELETE CASCADE, order_index,
  type TEXT CHECK(hero|text|image|columns|button|spacer),
  config JSONB   -- shape depends on type, see BlockEditor.tsx/BlockRenderer.tsx
)
website_menu_items(id, location TEXT CHECK(header|footer), label, url_or_slug, order_index, parent_id nullable -> self)
```

- No raw-HTML block type exists at all — the only free-form authoring surface is the `text`/`columns` blocks' Markdown fields, and even those never reach `dangerouslySetInnerHTML` (see "Rendering safety" below).
- `website_blocks`/`website_menu_items` are both replaced whole-list-by-id on save (`PUT .../blocks`, `PUT /menus/:location`) — the client generates a UUID per row (new or existing) via `crypto.randomUUID()`, the server upserts by id inside a transaction and deletes anything omitted. Same pattern as `survey`'s own `structure` endpoint.
- `parent_id` exists on `website_menu_items` but nothing in this module builds or renders a nested submenu — see "Known gotchas".

## Rendering safety

The one design question this module had to answer explicitly (root chat: "is Markdown safe for block text?"). Answer: Markdown itself is inert; the risk is a renderer that also executes embedded raw HTML, or an unsanitized render target. This module avoids both by construction rather than by sanitizing afterward:

- `frontend/pages/SafeMarkdown.tsx` is the ONLY place any block's Markdown is ever rendered — both the admin `PageEditorPage`'s live preview and the public `PublicSitePage` render every block through the same shared `BlockRenderer.tsx`, so the two code paths can never diverge.
- It renders via `react-markdown`, which turns Markdown into real React elements — no `dangerouslySetInnerHTML` anywhere in this module. By default (no `rehype-raw` plugin installed or configured) `react-markdown` does NOT execute raw HTML embedded in the Markdown source; a `<script>` tag typed into a `text` block's Markdown renders as inert literal text, not a DOM node.
- This is a deliberate change from the module's original plan-mode design (backend `markdown-it` + `sanitize-html`, HTML string piped through `dangerouslySetInnerHTML`) — simpler and inherently safer for a React SPA. See `DECISIONS.md`.

## Permissions

| Code | Gates |
|---|---|
| `website.pages.view` | Pages list, page detail/editor |
| `website.pages.create` / `.update` / `.delete` | Page CRUD, homepage toggle, blocks replace |
| `website.pages.publish` | Publish/unpublish |
| `website.menus.view` / `.update` | Menu read/replace |
| `website.settings.update` | The `site_config` setting |

`defaultRolePermissions`: `admin` gets everything; every other base role gets none — no base role obviously "runs the public site" the way `library_assistant` obviously runs circulation.

## Settings

`website.site_config` (`{ siteTitle, logoUrl }`) — read/written through `backend/settings.service.ts`'s own minimal endpoint (root D70/D71: the generic per-module Settings-screen surface doesn't exist yet, same pattern `library_circulation.loan_policy` already uses). No frontend page edits it yet — see "Known gotchas".

## Key files

- `backend/pages.service.ts` — page CRUD, homepage-exclusivity transaction (`update()` unsets any other homepage row when setting a new one), reserved-slug rejection (`assertSlugNotReserved`), `replaceBlocks()` (whole-list upsert-by-id/delete-omitted), `findPublicBySlug`/`findPublicHomepage` (404 unless `status === 'published'`).
- `backend/menus.service.ts` — same whole-list-replace pattern for `website_menu_items`.
- `backend/settings.service.ts` — `website.site_config` read/write.
- `backend/public.controller.ts` — the four `@Public()` read endpoints (pages/:slug, homepage, menus/:location, site-config); no `PublicThrottlerGuard` needed, every public endpoint here is a read.
- `frontend/pages/SafeMarkdown.tsx` / `BlockRenderer.tsx` — the shared, safe-by-construction rendering path described above.
- `frontend/pages/BlockEditor.tsx` — per-block-type admin form fields.
- `frontend/pages/PagesListPage.tsx` / `PageEditorPage.tsx` / `MenuEditorPage.tsx` — admin screens.
- `frontend/pages/PublicSitePage.tsx` + `SiteHeader.tsx` / `SiteFooter.tsx` — the visitor-facing `/site` and `/site/:slug` pages, resolving the header/footer menus and site config through the public read endpoints.
- `frontend/routes.tsx` — exports `authenticatedRoutes` (3 admin routes under `/site/admin/*`) and `publicRoutes` (`/site`, `/site/:slug`) — the fixed names every module's routes.tsx exports (root DECISIONS.md D78, `docs/MODULE_SPEC.md` §7.6); `App.tsx` discovers this generically, never by importing `website` by name.

## Known gotchas / deliberate v1 scope cuts (read before extending)

- **One shared `basePath` for admin and public routes.** `packages/shared-types/src/module-manifest.ts`'s manifest schema requires EVERY route (public or authenticated) to nest under the module's single `frontend.basePath` — there's no carve-out for public routes. This module's `basePath` is `/site`; admin routes are nested at `/site/admin/*` specifically so they don't collide with a visitor's page slug. `create-page.dto.ts`'s `RESERVED_SLUGS = ['admin']` blocks a page literally slugged `"admin"` server-side, as a defensive backstop to React Router's own static-beats-dynamic route ranking (which already resolves `/site/admin/*` correctly regardless of array order).
- **No nested/parent-child menu UI.** `website_menu_items.parent_id` exists in the schema (for a future submenu), but neither `MenuEditorPage.tsx` nor `SiteHeader`/`SiteFooter` build or render one — every item renders as a single flat row/link today.
- **No image upload anywhere.** Every `imageUrl` field (hero background, image block, site logo) is a plain text field the admin fills with an externally-hosted URL — consistent with root ASSUMPTIONS.md A13 ("no file/image-upload capability exists anywhere on the platform"), not a gap unique to this module.
- **No settings frontend page.** `website.site_config` is reachable through `GET/PUT /api/website/settings/site-config` but has no admin UI screen yet — same gap as `library_circulation.loan_policy`, tracked as a platform-wide "no generic per-module settings UI" limitation (root D70/D71), not something to build ad hoc per module.
- **No drag-and-drop block/menu reordering** — `PageEditorPage`/`MenuEditorPage` use up/down icon buttons only, matching the "much simpler than Odoo" brief; a fast-follow if real drag-and-drop is wanted later.
- **Public `/site/*` routes render inside the same `PageLayout` chrome as the rest of the app when reached by an already-authenticated user** (same as `library_catalog`'s own public availability page — see `App.tsx`'s route wiring) — a fully chrome-free public browsing experience for a logged-in visitor was not built; an anonymous visitor with no session sees the page standalone (no sidebar/top bar app chrome beyond `TopBar`).

## How to extend

Follow `docs/FEATURE_TEMPLATE.md` for any new endpoint or block type (manifest permission → guard → `@Audit` → locale keys in `ar`+`en` → tests). Adding a new block `type` touches four places together: the `WEBSITE_BLOCK_TYPES` const in `backend/dto/replace-blocks.dto.ts`, `emptyConfigFor()` in `frontend/api.ts`, `BlockEditor.tsx`, and `BlockRenderer.tsx` — keep all four in sync or the admin/public render paths will disagree.
