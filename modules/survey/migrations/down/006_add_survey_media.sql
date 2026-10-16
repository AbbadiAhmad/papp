-- down/006_add_survey_media.sql
--
-- Reverses 006_add_survey_media.sql. The image FILES in the media volume are not touched.

ALTER TABLE IF EXISTS survey_sections DROP COLUMN IF EXISTS image;
DROP TABLE IF EXISTS survey_media;
