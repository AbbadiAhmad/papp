-- down/005_add_response_limit_and_settings.sql
--
-- Reverses 005_add_response_limit_and_settings.sql.

ALTER TABLE IF EXISTS survey_surveys
    DROP CONSTRAINT IF EXISTS survey_surveys_response_limit_positive,
    DROP COLUMN IF EXISTS response_limit,
    DROP COLUMN IF EXISTS settings;
