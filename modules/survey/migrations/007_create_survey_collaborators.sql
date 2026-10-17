-- 007_create_survey_collaborators.sql
--
-- survey module — co-owners (survey ext. G, SURVEY-D21). A co-owner may edit, publish/close/reopen and read the
-- results of ONE survey even when their role lacks the general survey.surveys.update / publish /
-- survey.responses.view permissions. They cannot delete or archive the survey, nor manage its co-owners.
-- user_id is a plain column (no FK to core users), like every other module's user reference.

CREATE TABLE IF NOT EXISTS survey_collaborators (
    survey_id  UUID NOT NULL REFERENCES survey_surveys (id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    added_by   UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (survey_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_survey_collaborators_user ON survey_collaborators (user_id);
