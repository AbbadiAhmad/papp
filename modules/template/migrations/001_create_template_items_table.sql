-- 001_create_template_items_table.sql
--
-- template module — the ONE deliberately simple entity this scaffold exists
-- to demonstrate plumbing around, not domain complexity (docs/MODULE_SPEC.md
-- §10). Copy this file's shape for a real module's own first migration:
-- table prefixed with the module key (collision-avoidance, since table names
-- aren't schema-namespaced — every module does this), a real Postgres ENUM
-- (not TEXT + CHECK) for `status` because Prisma's `enum` mapping requires
-- one (confirmed the hard way building `library_catalog`/`survey` — see
-- their own DECISIONS.md), and `updated_at` present from the start so an
-- `@Audit`'ed update has a real before/after diff beyond the changed field.
--
-- No permission/role seeding here — a real installable module registers its
-- `permissions`/`defaultRolePermissions` through ModuleRegistryService at
-- install time from manifest.json (MODULE_SPEC.md §4 step 4), never via SQL
-- (that's only how CORE's own migrations seed the catalog, D46).

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_item_status') THEN
        CREATE TYPE template_item_status AS ENUM ('active', 'archived');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS template_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    status          template_item_status NOT NULL DEFAULT 'active',
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS template_items_owner_idx ON template_items (owner_user_id);
CREATE INDEX IF NOT EXISTS template_items_status_idx ON template_items (status);
