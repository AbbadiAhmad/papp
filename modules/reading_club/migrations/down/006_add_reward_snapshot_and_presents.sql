-- down/006_add_reward_snapshot_and_presents.sql
--
-- Reverses 006_add_reward_snapshot_and_presents.sql.

DROP TABLE IF EXISTS reading_club_presents;
ALTER TABLE IF EXISTS reading_club_stage_completions DROP COLUMN IF EXISTS reward_snapshot;
