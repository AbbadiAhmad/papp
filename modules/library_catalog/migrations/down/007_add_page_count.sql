-- down/007_add_page_count.sql
--
-- Reverses 007_add_page_count.sql: drops the `page_count` column (and its
-- CHECK constraint, implicitly, since Postgres drops column-level
-- constraints along with the column itself) from library_catalog_books.

ALTER TABLE IF EXISTS library_catalog_books
    DROP COLUMN IF EXISTS page_count;
