-- down/002_add_episodes.sql
--
-- Reverses 002_add_episodes.sql. Runs AFTER down/003 (descending filename
-- order undoes 003 first, so the FK/NOT NULL/snapshot-column changes on
-- reading_club_stage_book_entries are already reverted before this file
-- drops that table entirely).
--
-- Order: drop reading_club_stage_book_entries (references episodes/groups/
-- stages/borrowings/book_copies — child, drop first), then drop the
-- episode_id columns + their indexes off groups/memberships/completions,
-- then drop reading_club_episodes itself (its own partial unique index goes
-- with it automatically).
--
-- No data-loss caveat needed here the way 003's down has one: unlike NOT
-- NULL restoration, dropping a column/table is always unconditionally safe.

DROP TABLE IF EXISTS reading_club_stage_book_entries;

DROP INDEX IF EXISTS reading_club_groups_episode_idx;
DROP INDEX IF EXISTS reading_club_memberships_episode_idx;
DROP INDEX IF EXISTS reading_club_stage_completions_episode_idx;

ALTER TABLE IF EXISTS reading_club_groups
    DROP COLUMN IF EXISTS episode_id;
ALTER TABLE IF EXISTS reading_club_memberships
    DROP COLUMN IF EXISTS episode_id;
ALTER TABLE IF EXISTS reading_club_stage_completions
    DROP COLUMN IF EXISTS episode_id;

DROP TABLE IF EXISTS reading_club_episodes;
