-- 0000_bootstrap_registry.sql
--
-- Creates the two tables the module system's own bookkeeping depends on:
-- module_registry (what's installed) and module_migrations (what's been applied).
--
-- This is the ONE migration file in the whole platform allowed to run outside
-- the normal checksum-tracked flow: module_migrations doesn't exist yet the
-- first time the app boots, so MigrationRunnerService has nothing to check
-- applied-state against. apps/api/src/main.ts therefore executes this file
-- directly (via a plain `pg` client) before anything else touches the
-- database, then hands the very same file to MigrationRunnerService along
-- with the rest of core's migrations — from that point on it IS tracked like
-- any other migration.
--
-- Must stay idempotent (CREATE TABLE IF NOT EXISTS) since it can run on every
-- boot, not just the first.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'module_status') THEN
        CREATE TYPE module_status AS ENUM (
            'installing', 'installed', 'upgrading', 'disabled', 'uninstalling', 'failed'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS module_registry (
    key                 TEXT PRIMARY KEY,
    version             TEXT NOT NULL,
    status              module_status NOT NULL,
    installed_at        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    manifest_snapshot   JSONB
);

CREATE TABLE IF NOT EXISTS module_migrations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key  TEXT NOT NULL,
    filename    TEXT NOT NULL,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (module_key, filename)
);
