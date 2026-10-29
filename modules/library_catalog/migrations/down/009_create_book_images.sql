-- down/009_create_book_images.sql
--
-- Reverses 009_create_book_images.sql. The files in BOOK_FILES_DIR are not touched.

DROP TABLE IF EXISTS library_catalog_book_images;
