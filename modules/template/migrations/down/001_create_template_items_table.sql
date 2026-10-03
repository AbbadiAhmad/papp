-- down/001_create_template_items_table.sql
--
-- Reverses 001_create_template_items_table.sql: drops template_items (its
-- own indexes go with it) and the ENUM type it created.

DROP TABLE IF EXISTS template_items;

DROP TYPE IF EXISTS template_item_status;
