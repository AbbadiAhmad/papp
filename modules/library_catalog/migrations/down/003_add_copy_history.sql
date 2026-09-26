-- down/003_add_copy_history.sql
--
-- Reverses 003_add_copy_history.sql: drops the GIN index and the `history`
-- JSONB column it added to library_catalog_book_copies. The table itself is
-- untouched here — down/002 drops it (applied AFTER this one, since
-- ModuleRegistryService.runDownMigrationsIfPresent runs migrations/down/*.sql
-- in DESCENDING filename order: 003 first, then 002, then 001).

DROP INDEX IF EXISTS library_catalog_copy_history_idx;

ALTER TABLE IF EXISTS library_catalog_book_copies
    DROP COLUMN IF EXISTS history;
