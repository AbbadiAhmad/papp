-- 003_add_archived_at.sql
--
-- survey module — archiving. Orthogonal to `status` (not a 4th enum value:
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds
-- it, and an archived survey should remember whether it was draft/closed).
-- NULL = not archived. Archiving a published survey also closes it (done in
-- SurveysService.archive), so an archived survey never accepts responses.

ALTER TABLE survey_surveys
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS survey_surveys_archived_idx ON survey_surveys (archived_at);
