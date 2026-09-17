-- 001_create_website_tables.sql
--
-- The `website` module (Odoo-website-inspired, "much more simpler", per the
-- user's own framing): a block-based public page builder plus header/footer
-- navigation menus. Deliberately no raw-HTML block type — the only
-- free-form authoring surface is a `text` block's `markdown` field, and
-- even that is rendered client-side via `react-markdown` (no raw HTML
-- passthrough, no `dangerouslySetInnerHTML`, see the module's own
-- DOCUMENTATION.md) rather than a full WYSIWYG/HTML editor.

CREATE TABLE IF NOT EXISTS website_pages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    is_homepage BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one homepage at a time — a partial unique index (Postgres has no
-- "unique except when false" constraint otherwise).
CREATE UNIQUE INDEX IF NOT EXISTS website_pages_one_homepage_idx ON website_pages (is_homepage) WHERE is_homepage;

CREATE TABLE IF NOT EXISTS website_blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id     UUID NOT NULL REFERENCES website_pages(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('hero', 'text', 'image', 'columns', 'button', 'spacer')),
    config      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS website_blocks_page_idx ON website_blocks (page_id, order_index);

CREATE TABLE IF NOT EXISTS website_menu_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location    TEXT NOT NULL CHECK (location IN ('header', 'footer')),
    label       TEXT NOT NULL,
    url_or_slug TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    parent_id   UUID REFERENCES website_menu_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS website_menu_items_location_idx ON website_menu_items (location, order_index);
