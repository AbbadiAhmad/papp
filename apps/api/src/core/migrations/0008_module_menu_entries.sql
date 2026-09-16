-- 0008_module_menu_entries.sql
--
-- Persists each installed module's manifest `menu` entries (MODULE_SPEC.md §2
-- / §4 step 5) so the frontend nav tree doesn't need to re-read every
-- installed module's manifest.json on every page load. Written by
-- ModuleRegistryService at install/upgrade time (docs/BUILD_PLAN.md Phase 5).
--
-- `id` is the manifest entry's own globally-unique string id (e.g.
-- "library_catalog.root"), not a generated UUID. `parent_id` is a PLAIN
-- column with no foreign key back to this same table: the shared Zod schema
-- (packages/shared-types/src/module-manifest.ts) already rejects an
-- unresolved parentId or a parentId cycle before ModuleRegistryService ever
-- writes a row, so a DB-level self-referential FK would only add
-- insert-ordering friction (parent-before-child) for no additional safety.
--
-- On uninstall, every row for that module_key is deleted outright (D26 only
-- protects DATA tables and system_settings — menu registration is pure
-- manifest metadata, safe to fully re-derive on reinstall).

CREATE TABLE IF NOT EXISTS module_menu_entries (
    id                      TEXT PRIMARY KEY,
    module_key              TEXT NOT NULL,
    label_i18n_key          TEXT NOT NULL,
    icon                    TEXT,
    parent_id               TEXT,
    "order"                 INTEGER NOT NULL,
    route                   TEXT NOT NULL,
    required_permission     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS module_menu_entries_module_key_idx ON module_menu_entries(module_key);
