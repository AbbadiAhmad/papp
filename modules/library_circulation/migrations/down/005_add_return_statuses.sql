-- down/005_add_return_statuses.sql
--
-- Reverses 005_add_return_statuses.sql: drops the CHECK constraint and the
-- two columns it added to library_borrowings.

ALTER TABLE IF EXISTS library_borrowings
    DROP CONSTRAINT IF EXISTS valid_return_status;

ALTER TABLE IF EXISTS library_borrowings
    DROP COLUMN IF EXISTS return_status,
    DROP COLUMN IF EXISTS return_notes;
