-- down/001_create_reading_club_tables.sql
--
-- Reverses 001_create_reading_club_tables.sql. Runs LAST (descending
-- filename sort), by which point down/002 and down/003 have already
-- stripped every later addition off these tables. Dropped in FK-safe
-- child-before-parent order: reading_club_stage_completions ->
-- reading_club_memberships -> reading_club_stages -> reading_club_groups.
-- (reading_club_stages.group_id -> reading_club_groups(id) was never
-- relaxed by 003 — still blocking — so groups must drop only after stages.)

DROP TABLE IF EXISTS reading_club_stage_completions;
DROP TABLE IF EXISTS reading_club_memberships;
DROP TABLE IF EXISTS reading_club_stages;
DROP TABLE IF EXISTS reading_club_groups;
