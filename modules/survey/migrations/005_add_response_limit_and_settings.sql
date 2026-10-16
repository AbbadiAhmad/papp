-- 005_add_response_limit_and_settings.sql
--
-- survey module — Phase C of modules/survey/ROADMAP.md:
--   * response_limit: close the survey to NEW responses once this many exist
--     (NULL = no cap). Enforced in ResponsesService under a per-survey advisory
--     lock so two simultaneous submissions cannot overshoot it.
--   * settings: one JSONB column for survey-level options, so future flags need
--     no migration. Today: { "thankYouMessage": string, "showProgressBar": boolean }.
--     Shape and limits are validated in backend/survey-settings.ts.
-- Existing surveys are unchanged: no cap, empty settings (default thank-you text,
-- no progress bar). The opens_at / closes_at columns already existed (migration
-- 001) but were never editable or enforced; they are now.

ALTER TABLE survey_surveys
    ADD COLUMN IF NOT EXISTS response_limit INTEGER NULL,
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'survey_surveys_response_limit_positive'
    ) THEN
        ALTER TABLE survey_surveys
            ADD CONSTRAINT survey_surveys_response_limit_positive CHECK (response_limit IS NULL OR response_limit > 0);
    END IF;
END
$$;
