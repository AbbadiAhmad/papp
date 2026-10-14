-- 002_add_closed_message.sql
--
-- survey module — an optional, admin-written message shown to a respondent
-- who opens the link of a CLOSED survey (user request: the generic "This
-- survey is not available." text should be customizable per survey).
-- NULL = fall back to the generic localized message.

ALTER TABLE survey_surveys
    ADD COLUMN IF NOT EXISTS closed_message TEXT;
