-- 001_create_books_table.sql
--
-- library_catalog module — the catalog record (docs/LIBRARY_MODULE_REQUIREMENTS.md
-- §4: id, title, author, publisher, category, reading_level, language,
-- description, cover_image, created_at). `updated_at` is added beyond that
-- literal field list, mirroring every other table in this platform (core's
-- own tables all carry it) and needed so `update` actions have a real
-- "before vs after" audit diff beyond just the changed field(s) — flagged in
-- this module's developer report per CLAUDE.md's "flag assumptions" rule.
--
-- Table prefixed `library_catalog_` (MODULE_SPEC.md §5's collision-avoidance
-- convention — table names are not schema-namespaced, so every module
-- prefixes its own). `gen_random_uuid()` matches every core migration's own
-- UUID-default convention (see apps/api/src/core/migrations/0001_*.sql).
--
-- No permission/role seeding here: unlike core's own migrations (which seed
-- `permissions`/`role_permissions` directly via SQL, D46), a real installable
-- module registers its `permissions`/`defaultRolePermissions` through
-- ModuleRegistryService at install time from manifest.json (MODULE_SPEC.md
-- §4 step 4) — this migration only ever creates this module's own tables.

CREATE TABLE IF NOT EXISTS library_catalog_books (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    author          TEXT,
    publisher       TEXT,
    category        TEXT,
    reading_level   TEXT,
    language        TEXT,
    description     TEXT,
    cover_image     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_catalog_books_title_idx ON library_catalog_books (title);
CREATE INDEX IF NOT EXISTS library_catalog_books_category_idx ON library_catalog_books (category);
