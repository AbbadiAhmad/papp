-- down/002_create_book_copies_table.sql
--
-- Reverses 002_create_book_copies_table.sql: drops library_catalog_book_copies
-- (its own indexes go with it automatically) and the ENUM type it created.
-- Runs AFTER down/003 (descending filename sort undoes the newest migration
-- first) so 003's own column/index on this table are already gone by the
-- time the whole table is dropped here — order doesn't strictly matter for
-- DROP TABLE itself, but keeps the "reverse of apply order" story exact.

DROP TABLE IF EXISTS library_catalog_book_copies;

DROP TYPE IF EXISTS library_catalog_book_copy_status;
