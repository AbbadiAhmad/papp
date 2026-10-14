-- 004_add_section_navigation.sql
--
-- survey module — sections are shown one page at a time; each section can say
-- where the respondent goes next. JSONB so no new enum value / table is
-- needed: { "defaultTarget": null | "submit" | "<later section id>",
--           "routes": [{ "sourceQuestionId", "sourceOptionValue", "target" }] }
-- '{}' (the default) = "continue to the next section", i.e. unchanged
-- behaviour for every existing survey. Ids inside are validated at
-- structure-save time (SurveysService.validateStructure), not by FKs.

ALTER TABLE survey_sections
    ADD COLUMN IF NOT EXISTS navigation JSONB NOT NULL DEFAULT '{}'::jsonb;
