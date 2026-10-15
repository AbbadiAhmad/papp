-- down/008_create_book_files.sql
--
-- Reverses 008_create_book_files.sql. The files in BOOK_FILES_DIR are not touched.

DROP TABLE IF EXISTS library_catalog_book_files;
