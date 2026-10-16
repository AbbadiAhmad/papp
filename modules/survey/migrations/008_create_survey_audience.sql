-- 008_create_survey_audience.sql
--
-- survey module — who may respond, invitations (survey ext. H, SURVEY-D22).
-- A survey flagged restricted (survey_surveys.settings.restricted, no column needed) accepts responses only from
--   * logged-in users listed in survey_allowed_users, or
--   * people holding a personal link from survey_invitations (or logged in with an account whose email matches one).
-- Invitation links are NOT stored: the token is an HMAC of the invitation id, so a reminder re-sends the same link
-- and deleting the invitation revokes it. The invitation records only whether the person opened/answered it, never
-- which response is theirs, so an invited survey can still be anonymous.

CREATE TABLE IF NOT EXISTS survey_allowed_users (
    survey_id  UUID NOT NULL REFERENCES survey_surveys (id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    added_by   UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (survey_id, user_id)
);

CREATE TABLE IF NOT EXISTS survey_invitations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id        UUID NOT NULL REFERENCES survey_surveys (id) ON DELETE CASCADE,
    email            TEXT NOT NULL CHECK (email = lower(email)),
    invited_by       UUID NULL,
    invited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    opened_at        TIMESTAMPTZ NULL,
    responded_at     TIMESTAMPTZ NULL,
    last_reminder_at TIMESTAMPTZ NULL,
    reminder_count   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (survey_id, email)
);

CREATE INDEX IF NOT EXISTS idx_survey_invitations_email ON survey_invitations (email);
