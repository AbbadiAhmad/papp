-- 006_add_reward_snapshot_and_presents.sql
--
-- 1. reading_club_stage_completions.reward_snapshot (JSONB): the present as
--    it was when the stage was finished ({description, episodeName,
--    groupName, stageName, stageOrder}), so later edits/deletion of the
--    stage never change history. Existing rows are backfilled from their
--    stage where it still exists. See READING_CLUB-D24.
-- 2. reading_club_presents: presents the librarian gives a reader outside
--    the stage flow, with free text and a JSONB snapshot of the
--    episode/group/stage at the time. See READING_CLUB-D25.

ALTER TABLE reading_club_stage_completions
    ADD COLUMN IF NOT EXISTS reward_snapshot JSONB;

UPDATE reading_club_stage_completions c
SET reward_snapshot = jsonb_build_object(
        'description', (SELECT s.reward_description FROM reading_club_stages s WHERE s.id = c.stage_id),
        'episodeName', (SELECT e.name FROM reading_club_episodes e WHERE e.id = c.episode_id),
        'groupName', c.group_name,
        'stageName', c.stage_name,
        'stageOrder', c.stage_order)
WHERE c.reward_snapshot IS NULL;

CREATE TABLE IF NOT EXISTS reading_club_presents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  UUID NOT NULL REFERENCES library_students(id) ON DELETE CASCADE,
    episode_id  UUID NOT NULL REFERENCES reading_club_episodes(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    context     JSONB,
    given_by    UUID NOT NULL REFERENCES users(id),
    given_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reading_club_presents_student_idx ON reading_club_presents (student_id);
CREATE INDEX IF NOT EXISTS reading_club_presents_episode_idx ON reading_club_presents (episode_id);
