-- 001_create_reading_club_tables.sql
--
-- reading_club module: reading groups made of ordered stages (each stage
-- worth an incremental amount of books OR pages), a reader's current
-- group/stage assignment, and an append-only stage-completion/reward
-- history. Depends on library_circulation's `library_students` (manifest
-- `dependsOn`) — a "reader" here is the same library_students row the
-- circulation module's scan screen already resolves (STU-prefixed code).
--
-- Full history is never deleted (same "reading passport" philosophy as
-- library_circulation, docs/LIBRARY_MODULE_REQUIREMENTS.md §10) — no
-- ON DELETE CASCADE from students here; deleting a group/stage that a
-- reader's history references is rejected at the service layer, not by a
-- DB FK action, so the protection rule returns a clear error.

CREATE TABLE IF NOT EXISTS reading_club_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID NOT NULL REFERENCES users(id)
);

-- A stage's `target_amount` is the amount OF THAT STAGE ALONE (incremental,
-- not cumulative) — "stage 1 is 5 books, stage 2 is an ADDITIONAL 10 books"
-- is target_amount = 5 then 10, not 5 then 15. `stage_order` is unique per
-- group and defines the fixed progression sequence.
CREATE TABLE IF NOT EXISTS reading_club_stages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id          UUID NOT NULL REFERENCES reading_club_groups(id),
    stage_order       INTEGER NOT NULL,
    name              TEXT NOT NULL,
    target_type       TEXT NOT NULL CHECK (target_type IN ('books', 'pages')),
    target_amount     INTEGER NOT NULL CHECK (target_amount > 0),
    reward_description TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (group_id, stage_order)
);
CREATE INDEX IF NOT EXISTS reading_club_stages_group_idx ON reading_club_stages (group_id);

-- One active membership per reader (a reader belongs to exactly one group
-- at a time, per the librarian's requirement) — `student_id` is UNIQUE.
-- `stage_started_at` anchors the live "books returned since entering this
-- stage" progress computation for `target_type = 'books'`;
-- `manual_progress_amount` is the librarian-entered running total used only
-- for `target_type = 'pages'` stages, where no page-count data exists
-- anywhere in the catalog to compute it automatically (see DECISIONS.md).
CREATE TABLE IF NOT EXISTS reading_club_memberships (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id             UUID NOT NULL UNIQUE REFERENCES library_students(id),
    group_id               UUID NOT NULL REFERENCES reading_club_groups(id),
    current_stage_id       UUID REFERENCES reading_club_stages(id),
    stage_started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    manual_progress_amount INTEGER NOT NULL DEFAULT 0,
    assigned_by            UUID NOT NULL REFERENCES users(id),
    assigned_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reading_club_memberships_group_idx ON reading_club_memberships (group_id);
CREATE INDEX IF NOT EXISTS reading_club_memberships_stage_idx ON reading_club_memberships (current_stage_id);

-- Append-only: every time a librarian marks a stage finished, one row is
-- created here (a snapshot of the target/progress at that moment) and the
-- membership's `current_stage_id` advances immediately — reward delivery is
-- tracked independently via `reward_status`, so "finished the stage" and
-- "physically handed the present" can happen at different times (the
-- circulation scan-page hook confirms the latter, possibly days later).
CREATE TABLE IF NOT EXISTS reading_club_stage_completions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id                  UUID NOT NULL REFERENCES library_students(id),
    group_id                    UUID NOT NULL REFERENCES reading_club_groups(id),
    stage_id                    UUID NOT NULL REFERENCES reading_club_stages(id),
    target_amount_at_completion INTEGER NOT NULL,
    progress_amount_at_completion INTEGER NOT NULL,
    completed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    marked_by                   UUID NOT NULL REFERENCES users(id),
    reward_status                TEXT NOT NULL DEFAULT 'pending' CHECK (reward_status IN ('pending', 'delivered')),
    reward_delivered_at          TIMESTAMPTZ,
    reward_delivered_by          UUID REFERENCES users(id),
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reading_club_stage_completions_student_idx ON reading_club_stage_completions (student_id);
CREATE INDEX IF NOT EXISTS reading_club_stage_completions_reward_status_idx ON reading_club_stage_completions (reward_status);
