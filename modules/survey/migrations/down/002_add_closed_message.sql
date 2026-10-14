-- down/002_add_closed_message.sql
--
-- Reverses 002_add_closed_message.sql.

ALTER TABLE IF EXISTS survey_surveys
    DROP COLUMN IF EXISTS closed_message;
