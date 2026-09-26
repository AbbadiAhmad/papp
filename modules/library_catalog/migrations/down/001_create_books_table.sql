-- down/001_create_books_table.sql
--
-- Reverses 001_create_books_table.sql. Runs LAST (descending filename sort)
-- so library_catalog_book_copies (down/002, which FK-references this table)
-- is already dropped by the time this DROP TABLE runs.

DROP TABLE IF EXISTS library_catalog_books;
