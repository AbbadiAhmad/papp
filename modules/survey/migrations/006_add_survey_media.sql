-- 006_add_survey_media.sql
--
-- survey module — Phase D of modules/survey/ROADMAP.md (images, SURVEY-D18).
--   * survey_media: one row per uploaded picture. The BYTES are stored in the API's media volume
--     (SURVEY_MEDIA_DIR) as <id>.<ext>, never in the database; this row is the index/ownership record.
--   * survey_sections.image: { "mediaId": uuid, "alt": text } or NULL. Question and header images are
--     referenced from the existing JSONB columns (config.image / settings.headerImage).
-- Deleting a survey cascades to its media rows; the application removes the files.

CREATE TABLE IF NOT EXISTS survey_media (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id   UUID NOT NULL REFERENCES survey_surveys (id) ON DELETE CASCADE,
    mime        TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
    size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
    created_by  UUID NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_survey_media_survey ON survey_media (survey_id);

ALTER TABLE survey_sections ADD COLUMN IF NOT EXISTS image JSONB NULL;
