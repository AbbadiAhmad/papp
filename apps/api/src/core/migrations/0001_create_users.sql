-- 0001_create_users.sql
--
-- Core `users` table (see docs/BUILD_PLAN.md §2 and Phase 1 scope).
--
-- Beyond BUILD_PLAN.md §2's literal field outline, this adds two columns
-- (`failed_login_attempts`, `locked_until`) not listed there. Account
-- lockout ("5 failed attempts -> 15 minute lockout", per auth.password_policy
-- in 0003_create_system_settings.sql) cannot be implemented without somewhere
-- to persist the running failure count and the lockout expiry, so these were
-- added here and mirrored in prisma/schema.prisma. Flagged in the Phase 1
-- developer report for confirmation.

CREATE TABLE IF NOT EXISTS users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   TEXT NOT NULL UNIQUE,
    name                    TEXT NOT NULL,
    external_id             TEXT UNIQUE,
    department              TEXT,
    password_hash           TEXT NOT NULL,
    must_change_password    BOOLEAN NOT NULL DEFAULT false,
    is_active               BOOLEAN NOT NULL DEFAULT true,
    failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    last_login_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID
);
