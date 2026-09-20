-- 004_add_borrowing_history.sql
--
-- Feature 2.2: Circulation History Endpoint
-- Adds a JSON history field to track full borrowing records including status changes.

ALTER TABLE library_borrowings
ADD COLUMN circulation_history JSONB DEFAULT '[]';

-- Create an index for efficient JSON queries
CREATE INDEX library_borrowing_circulation_history_idx ON library_borrowings USING GIN (circulation_history);
