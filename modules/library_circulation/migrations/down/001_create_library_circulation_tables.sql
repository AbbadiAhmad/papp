-- down/001_create_library_circulation_tables.sql
--
-- Reverses 001_create_library_circulation_tables.sql. Runs LAST (descending
-- filename sort undoes 005/004/003/002 first, stripping the columns/
-- constraints/sequences they added off these same tables before the tables
-- themselves are dropped here). Dropped in FK-safe child-before-parent
-- order: library_receipts -> library_payments -> library_financial_transactions
-- -> library_fines -> library_borrowings -> library_fine_types ->
-- library_students -> library_academic_years. library_borrowings itself also
-- FK-references library_catalog_book_copies (a different, still-installed-or-
-- not-yet-uninstalled module per the platform's new dependency guard, root
-- D86) — dropping library_borrowings here never touches that other module's
-- table, only removes the referencing row's own table.

DROP TABLE IF EXISTS library_receipts;
DROP TABLE IF EXISTS library_payments;
DROP TABLE IF EXISTS library_financial_transactions;
DROP TABLE IF EXISTS library_fines;
DROP TABLE IF EXISTS library_borrowings;
DROP TABLE IF EXISTS library_fine_types;
DROP TABLE IF EXISTS library_students;
DROP TABLE IF EXISTS library_academic_years;
