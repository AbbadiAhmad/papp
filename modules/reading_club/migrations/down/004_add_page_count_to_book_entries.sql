-- down/004_add_page_count_to_book_entries.sql
--
-- Reverses 004_add_page_count_to_book_entries.sql: drops the `page_count`
-- column (and its CHECK constraint, implicitly) from
-- reading_club_stage_book_entries.

ALTER TABLE IF EXISTS reading_club_stage_book_entries
    DROP COLUMN IF EXISTS page_count;
