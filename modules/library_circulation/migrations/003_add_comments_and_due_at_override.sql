-- 003_add_comments_and_due_at_override.sql
--
-- Feature 5.1: Borrow Dialog Information
-- Allows librarians to add optional comments when borrowing books
-- and override the expected return date (due date) from the loan policy default.

ALTER TABLE library_borrowings
ADD COLUMN comments TEXT;
