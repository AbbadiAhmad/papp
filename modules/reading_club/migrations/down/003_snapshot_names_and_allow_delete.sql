-- down/003_snapshot_names_and_allow_delete.sql
--
-- Reverses 003_snapshot_names_and_allow_delete.sql's two changes:
--  1. Restores the FK actions this migration relaxed to ON DELETE SET NULL
--     back to their ORIGINAL implicit-default (blocking/NO ACTION) behavior,
--     under the SAME constraint names (the up-migration itself DROPped and
--     re-ADDed these same names, so restoring them the same way is exact),
--     and restores NOT NULL on the columns that were NOT NULL before this
--     migration ran (reading_club_memberships.group_id;
--     reading_club_stage_completions.group_id/stage_id;
--     reading_club_stage_book_entries.group_id/stage_id — per 001/002's own
--     original column definitions). reading_club_memberships.current_stage_id
--     was already nullable before 003 (only its FK action changed), so it is
--     restored to a blocking FK but left nullable.
--  2. Drops the snapshot columns (group_name/stage_name/stage_order) this
--     migration added.
--
-- NOTE: restoring NOT NULL here will fail if any live row currently has a
-- NULL group_id/stage_id (i.e. a group/stage was deleted post-003, per
-- READING_CLUB-D16's "orphaned current membership" behavior this migration
-- deliberately enabled). This is the correct, honest behavior for a down-
-- migration undoing a schema relaxation: it cannot silently invent a
-- group/stage for an orphaned history row, so it fails loud rather than
-- corrupt data — same "never silently swallow a real conflict" principle
-- documented for every other unfixable-inverse case in this platform. This
-- is expected to be a non-issue for --drop-data anyway: --drop-data uninstalls
-- the WHOLE module (down/001 drops every one of these tables entirely right
-- after this file runs), so any such failure only matters if this file is
-- ever run in isolation outside the uninstall flow.

-- --------------------------------------------------------------------------
-- Step 1: restore original (blocking) FK actions.
-- --------------------------------------------------------------------------
ALTER TABLE IF EXISTS reading_club_memberships
    DROP CONSTRAINT IF EXISTS reading_club_memberships_group_id_fkey,
    ADD CONSTRAINT reading_club_memberships_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES reading_club_groups(id);

ALTER TABLE IF EXISTS reading_club_memberships
    DROP CONSTRAINT IF EXISTS reading_club_memberships_current_stage_id_fkey,
    ADD CONSTRAINT reading_club_memberships_current_stage_id_fkey
        FOREIGN KEY (current_stage_id) REFERENCES reading_club_stages(id);

ALTER TABLE IF EXISTS reading_club_stage_completions
    DROP CONSTRAINT IF EXISTS reading_club_stage_completions_group_id_fkey,
    ADD CONSTRAINT reading_club_stage_completions_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES reading_club_groups(id);

ALTER TABLE IF EXISTS reading_club_stage_completions
    DROP CONSTRAINT IF EXISTS reading_club_stage_completions_stage_id_fkey,
    ADD CONSTRAINT reading_club_stage_completions_stage_id_fkey
        FOREIGN KEY (stage_id) REFERENCES reading_club_stages(id);

ALTER TABLE IF EXISTS reading_club_stage_book_entries
    DROP CONSTRAINT IF EXISTS reading_club_stage_book_entries_group_id_fkey,
    ADD CONSTRAINT reading_club_stage_book_entries_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES reading_club_groups(id);

ALTER TABLE IF EXISTS reading_club_stage_book_entries
    DROP CONSTRAINT IF EXISTS reading_club_stage_book_entries_stage_id_fkey,
    ADD CONSTRAINT reading_club_stage_book_entries_stage_id_fkey
        FOREIGN KEY (stage_id) REFERENCES reading_club_stages(id);

-- --------------------------------------------------------------------------
-- Step 2: restore original NOT NULL on the columns 003 relaxed.
-- --------------------------------------------------------------------------
ALTER TABLE IF EXISTS reading_club_memberships
    ALTER COLUMN group_id SET NOT NULL;

ALTER TABLE IF EXISTS reading_club_stage_completions
    ALTER COLUMN group_id SET NOT NULL,
    ALTER COLUMN stage_id SET NOT NULL;

ALTER TABLE IF EXISTS reading_club_stage_book_entries
    ALTER COLUMN group_id SET NOT NULL,
    ALTER COLUMN stage_id SET NOT NULL;

-- --------------------------------------------------------------------------
-- Step 3: drop the snapshot columns this migration added.
-- --------------------------------------------------------------------------
ALTER TABLE IF EXISTS reading_club_memberships
    DROP COLUMN IF EXISTS group_name,
    DROP COLUMN IF EXISTS stage_name;

ALTER TABLE IF EXISTS reading_club_stage_completions
    DROP COLUMN IF EXISTS group_name,
    DROP COLUMN IF EXISTS stage_name,
    DROP COLUMN IF EXISTS stage_order;

ALTER TABLE IF EXISTS reading_club_stage_book_entries
    DROP COLUMN IF EXISTS group_name,
    DROP COLUMN IF EXISTS stage_name;
