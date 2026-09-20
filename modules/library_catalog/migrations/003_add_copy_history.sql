-- 003_add_copy_history.sql
--
-- Feature 2.1: Catalog History Endpoint
-- Adds a JSON history field to track changes to copy status, condition, and location.

ALTER TABLE library_catalog_book_copies
ADD COLUMN history JSONB DEFAULT '[]';

-- Create an index for efficient JSON queries
CREATE INDEX library_catalog_copy_history_idx ON library_catalog_book_copies USING GIN (history);
