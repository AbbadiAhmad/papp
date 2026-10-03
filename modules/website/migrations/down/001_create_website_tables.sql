-- down/001_create_website_tables.sql
--
-- Reverses 001_create_website_tables.sql. Dropped in FK-safe child-before-
-- parent order: website_menu_items (self-referencing parent_id, ON DELETE
-- CASCADE handles the self-FK) -> website_blocks -> website_pages.

DROP TABLE IF EXISTS website_menu_items;
DROP TABLE IF EXISTS website_blocks;
DROP TABLE IF EXISTS website_pages;
