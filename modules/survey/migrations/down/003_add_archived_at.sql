-- down/003_add_archived_at.sql
--
-- Reverses 003_add_archived_at.sql.

DROP INDEX IF EXISTS survey_surveys_archived_idx;
ALTER TABLE IF EXISTS survey_surveys
    DROP COLUMN IF EXISTS archived_at;
