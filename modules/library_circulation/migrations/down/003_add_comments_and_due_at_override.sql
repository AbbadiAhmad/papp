-- down/003_add_comments_and_due_at_override.sql
--
-- Reverses 003_add_comments_and_due_at_override.sql: drops the `comments`
-- column it added to library_borrowings. (Despite the up-migration's own
-- filename mentioning a "due_at override", it never actually added a
-- separate override column — `due_at` itself is already writable on
-- library_borrowings from 001 — so there is nothing else to reverse here.)

ALTER TABLE IF EXISTS library_borrowings
    DROP COLUMN IF EXISTS comments;
