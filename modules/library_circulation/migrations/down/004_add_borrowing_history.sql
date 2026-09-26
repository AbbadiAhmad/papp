-- down/004_add_borrowing_history.sql
--
-- Reverses 004_add_borrowing_history.sql: drops the GIN index and the
-- `circulation_history` JSONB column it added to library_borrowings.

DROP INDEX IF EXISTS library_borrowing_circulation_history_idx;

ALTER TABLE IF EXISTS library_borrowings
    DROP COLUMN IF EXISTS circulation_history;
