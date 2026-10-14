-- down/004_add_section_navigation.sql
--
-- Reverses 004_add_section_navigation.sql.

ALTER TABLE IF EXISTS survey_sections
    DROP COLUMN IF EXISTS navigation;
