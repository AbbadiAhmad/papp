-- 002_add_episodes.sql
--
-- Adds "episodes" (seasons/years) as the top-level scope everything else in
-- this module now lives under, and per-stage book tracking
-- (reading_club_stage_book_entries). See DECISIONS.md READING_CLUB-D10..D14
-- for the full reasoning behind every choice below.
--
-- *** THIS MIGRATION DELETES ALL EXISTING reading_club DATA ***
-- Explicitly confirmed TWICE by the user, understanding it is irreversible:
-- the data is pre-production/planning-stage, nothing real to preserve. This
-- lets `episode_id` be added as NOT NULL with no backfill step. Never do
-- this in a migration touching real production data — see READING_CLUB-D11.

-- Wipe existing rows (FK-safe order: children before parents) so the new
-- NOT NULL episode_id columns below can be added cleanly.
TRUNCATE TABLE reading_club_stage_completions, reading_club_memberships, reading_club_stages, reading_club_groups RESTART IDENTITY CASCADE;

-- --------------------------------------------------------------------------
-- Episodes: one global "current" episode at a time. Groups/stages fully
-- belong to one episode (episode ownership, not shared config across
-- episodes) — see READING_CLUB-D10. `is_current` at-most-one is enforced by
-- a partial unique index (the standard Postgres idiom for "at most one row
-- where a boolean is true" — a plain UNIQUE constraint can't express this
-- since it would also forbid multiple `is_current = false` rows).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_club_episodes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT false,
    starts_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at    TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reading_club_episodes_one_current
    ON reading_club_episodes (is_current)
    WHERE is_current;

-- --------------------------------------------------------------------------
-- episode_id on groups/memberships/completions. Stages stay scoped only via
-- their existing group_id FK (a stage inherits its episode from its group;
-- adding episode_id there too would be redundant, denormalized data that
-- could drift from its own group's episode_id).
-- --------------------------------------------------------------------------
ALTER TABLE reading_club_groups
    ADD COLUMN IF NOT EXISTS episode_id UUID REFERENCES reading_club_episodes(id);

ALTER TABLE reading_club_memberships
    ADD COLUMN IF NOT EXISTS episode_id UUID REFERENCES reading_club_episodes(id);

ALTER TABLE reading_club_stage_completions
    ADD COLUMN IF NOT EXISTS episode_id UUID REFERENCES reading_club_episodes(id);

-- The tables above were just TRUNCATEd, so there is no existing data to
-- backfill — safe to tighten straight to NOT NULL in the same migration.
ALTER TABLE reading_club_groups ALTER COLUMN episode_id SET NOT NULL;
ALTER TABLE reading_club_memberships ALTER COLUMN episode_id SET NOT NULL;
ALTER TABLE reading_club_stage_completions ALTER COLUMN episode_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS reading_club_groups_episode_idx ON reading_club_groups (episode_id);
CREATE INDEX IF NOT EXISTS reading_club_memberships_episode_idx ON reading_club_memberships (episode_id);
CREATE INDEX IF NOT EXISTS reading_club_stage_completions_episode_idx ON reading_club_stage_completions (episode_id);

-- --------------------------------------------------------------------------
-- Per-stage book tracking (item D). Every returned borrowing inside a
-- reader's current stage window is auto-synced here (books-type AND
-- pages-type stages alike — the sync condition is the stage window, not the
-- stage's target_type, see READING_CLUB-D13); a librarian can also add a
-- free-typed manual entry. Every entry (auto or manual) can be soft-discarded
-- (struck-through, excluded from counts, but kept visible) or hard-deleted.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_club_stage_book_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id     UUID NOT NULL REFERENCES library_students(id),
    episode_id     UUID NOT NULL REFERENCES reading_club_episodes(id),
    group_id       UUID NOT NULL REFERENCES reading_club_groups(id),
    stage_id       UUID NOT NULL REFERENCES reading_club_stages(id),
    borrowing_id   UUID REFERENCES library_borrowings(id),       -- set for auto-sourced, NULL for manual
    book_copy_id   UUID REFERENCES library_catalog_book_copies(id), -- NULL if manual with no catalog link
    book_title     TEXT NOT NULL,
    book_code      TEXT,                                          -- copy's qrCode, snapshotted at entry time
    source         TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
    comments       TEXT,
    added_by       UUID NOT NULL REFERENCES users(id),
    added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discarded')),
    discarded_at   TIMESTAMPTZ,
    discarded_by   UUID REFERENCES users(id),
    discard_reason TEXT                                           -- optional — never required to discard an entry
);

CREATE INDEX IF NOT EXISTS reading_club_stage_book_entries_reader_stage_idx
    ON reading_club_stage_book_entries (student_id, group_id, stage_id);
-- Dedup lookup for the auto-sync step: "does a (possibly discarded) entry
-- already exist for this borrowing_id?" — see READING_CLUB-D13.
CREATE INDEX IF NOT EXISTS reading_club_stage_book_entries_borrowing_idx
    ON reading_club_stage_book_entries (borrowing_id);
