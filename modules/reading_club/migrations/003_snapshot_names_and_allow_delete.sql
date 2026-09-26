-- 003_snapshot_names_and_allow_delete.sql
--
-- Lets a librarian reconfigure a season's groups/stages (delete/redefine
-- them) WITHOUT losing that season's already-earned reward/completion
-- history. Deliberate, explicit user request — NOT a bug fix — see
-- DECISIONS.md READING_CLUB-D16 for the full reasoning.
--
-- Two changes, same migration:
--  1. Snapshot group/stage NAMES onto every history row at write time,
--     same philosophy 001 already used for target_amount_at_completion/
--     progress_amount_at_completion — a history row must display correctly
--     forever, even after the group/stage row it originally pointed at is
--     deleted (a live join can return null the moment that happens).
--  2. Relax the FK actions on every HISTORY table pointing at
--     reading_club_groups/reading_club_stages from the implicit default
--     (blocking) to ON DELETE SET NULL, so the group/stage row itself CAN
--     now be deleted even with history against it — the whole point of this
--     change (GroupsService.removeStage/removeGroup's own in-service history
--     check is being removed in the same commit, this migration only deals
--     with the DB-level FK half of that same block).
--
-- reading_club_stages.group_id -> reading_club_groups(id) is NOT touched —
-- a stage is owned by its group; removeGroup already explicitly deletes a
-- group's stages itself, in a transaction, before deleting the group.

-- --------------------------------------------------------------------------
-- Step 1: add nullable snapshot columns.
-- --------------------------------------------------------------------------
ALTER TABLE reading_club_memberships
    ADD COLUMN IF NOT EXISTS group_name TEXT,
    ADD COLUMN IF NOT EXISTS stage_name TEXT;

ALTER TABLE reading_club_stage_completions
    ADD COLUMN IF NOT EXISTS group_name TEXT,
    ADD COLUMN IF NOT EXISTS stage_name TEXT,
    ADD COLUMN IF NOT EXISTS stage_order INTEGER;

ALTER TABLE reading_club_stage_book_entries
    ADD COLUMN IF NOT EXISTS group_name TEXT,
    ADD COLUMN IF NOT EXISTS stage_name TEXT;

-- --------------------------------------------------------------------------
-- Step 2: backfill existing rows from the still-live group/stage rows,
-- BEFORE the FK behavior changes below (while every referenced row still
-- exists, so every history row gets a real snapshot, not a NULL one).
-- --------------------------------------------------------------------------
UPDATE reading_club_memberships m
SET group_name = g.name
FROM reading_club_groups g
WHERE m.group_id = g.id AND m.group_name IS NULL;

UPDATE reading_club_memberships m
SET stage_name = s.name
FROM reading_club_stages s
WHERE m.current_stage_id = s.id AND m.stage_name IS NULL;

UPDATE reading_club_stage_completions c
SET group_name = g.name
FROM reading_club_groups g
WHERE c.group_id = g.id AND c.group_name IS NULL;

UPDATE reading_club_stage_completions c
SET stage_name = s.name, stage_order = s.stage_order
FROM reading_club_stages s
WHERE c.stage_id = s.id AND c.stage_name IS NULL;

UPDATE reading_club_stage_book_entries e
SET group_name = g.name
FROM reading_club_groups g
WHERE e.group_id = g.id AND e.group_name IS NULL;

UPDATE reading_club_stage_book_entries e
SET stage_name = s.name
FROM reading_club_stages s
WHERE e.stage_id = s.id AND e.stage_name IS NULL;

-- --------------------------------------------------------------------------
-- Step 3: make group_id/stage_id/current_stage_id nullable on every HISTORY
-- table (a Postgres FK ON DELETE SET NULL action requires the column to
-- actually allow NULL) and swap each FK's action to ON DELETE SET NULL.
-- Constraint names below are the real, already-applied ones (confirmed via
-- \d against this repo's own dev database, not guessed).
-- --------------------------------------------------------------------------

-- reading_club_memberships.group_id (was NOT NULL) + current_stage_id
-- (already nullable, but its FK had no explicit ON DELETE action, i.e.
-- NO ACTION/blocking — needs the same SET NULL treatment).
ALTER TABLE reading_club_memberships ALTER COLUMN group_id DROP NOT NULL;

ALTER TABLE reading_club_memberships
    DROP CONSTRAINT reading_club_memberships_group_id_fkey,
    ADD CONSTRAINT reading_club_memberships_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES reading_club_groups(id) ON DELETE SET NULL;

ALTER TABLE reading_club_memberships
    DROP CONSTRAINT reading_club_memberships_current_stage_id_fkey,
    ADD CONSTRAINT reading_club_memberships_current_stage_id_fkey
        FOREIGN KEY (current_stage_id) REFERENCES reading_club_stages(id) ON DELETE SET NULL;

-- reading_club_stage_completions.group_id / stage_id (both were NOT NULL).
ALTER TABLE reading_club_stage_completions ALTER COLUMN group_id DROP NOT NULL;
ALTER TABLE reading_club_stage_completions ALTER COLUMN stage_id DROP NOT NULL;

ALTER TABLE reading_club_stage_completions
    DROP CONSTRAINT reading_club_stage_completions_group_id_fkey,
    ADD CONSTRAINT reading_club_stage_completions_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES reading_club_groups(id) ON DELETE SET NULL;

ALTER TABLE reading_club_stage_completions
    DROP CONSTRAINT reading_club_stage_completions_stage_id_fkey,
    ADD CONSTRAINT reading_club_stage_completions_stage_id_fkey
        FOREIGN KEY (stage_id) REFERENCES reading_club_stages(id) ON DELETE SET NULL;

-- reading_club_stage_book_entries.group_id / stage_id (both were NOT NULL).
ALTER TABLE reading_club_stage_book_entries ALTER COLUMN group_id DROP NOT NULL;
ALTER TABLE reading_club_stage_book_entries ALTER COLUMN stage_id DROP NOT NULL;

ALTER TABLE reading_club_stage_book_entries
    DROP CONSTRAINT reading_club_stage_book_entries_group_id_fkey,
    ADD CONSTRAINT reading_club_stage_book_entries_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES reading_club_groups(id) ON DELETE SET NULL;

ALTER TABLE reading_club_stage_book_entries
    DROP CONSTRAINT reading_club_stage_book_entries_stage_id_fkey,
    ADD CONSTRAINT reading_club_stage_book_entries_stage_id_fkey
        FOREIGN KEY (stage_id) REFERENCES reading_club_stages(id) ON DELETE SET NULL;
