-- down/001_create_survey_tables.sql
--
-- Reverses 001_create_survey_tables.sql. Dropped in FK-safe child-before-
-- parent order: survey_answers -> survey_responses -> survey_logic_rules ->
-- survey_question_options -> survey_questions -> survey_sections ->
-- survey_surveys, then the four ENUM types this migration created.

DROP TABLE IF EXISTS survey_answers;
DROP TABLE IF EXISTS survey_responses;
DROP TABLE IF EXISTS survey_logic_rules;
DROP TABLE IF EXISTS survey_question_options;
DROP TABLE IF EXISTS survey_questions;
DROP TABLE IF EXISTS survey_sections;
DROP TABLE IF EXISTS survey_surveys;

DROP TYPE IF EXISTS survey_logic_target_type;
DROP TYPE IF EXISTS survey_logic_action;
DROP TYPE IF EXISTS survey_question_type;
DROP TYPE IF EXISTS survey_status;
