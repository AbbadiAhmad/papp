-- 0016_add_user_date_of_birth.sql
--
-- Optional date of birth on the platform user (calendar date, no time zone).
-- Used by modules for age-based statistics (e.g. which books each age group
-- reads); NULL = unknown. Additive and idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
