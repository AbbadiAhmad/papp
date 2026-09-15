-- 0003_create_system_settings.sql
--
-- Core `system_settings` table (see docs/BUILD_PLAN.md §2, ARCHITECTURE.md
-- §6.3). Seeds the two keys Auth needs immediately: `auth.password_policy`
-- and `auth.token_lifetimes`. These are DEFAULTS — an admin can change them
-- later via the (Phase 4) Settings screen; SettingsService.set() is how that
-- happens, never a schema edit.
--
-- `auth.token_lifetimes` includes `idleTimeoutMinutes` and
-- `absoluteTimeoutDays` in addition to the access/refresh lifetimes spelled
-- out in BUILD_PLAN.md §2's literal seed description. ARCHITECTURE.md §6.1
-- point 7 requires both an idle timeout AND an absolute session timeout,
-- both admin-configurable via system_settings (D24) — there is nowhere else
-- for those values to live, so they were added here. Flagged in the Phase 1
-- developer report for confirmation.
--
-- INSERT ... ON CONFLICT DO NOTHING keeps this file idempotent SQL in its
-- own right (defense in depth), even though MigrationRunnerService already
-- guarantees a checksum-tracked file is never re-applied.

CREATE TABLE IF NOT EXISTS system_settings (
    key           TEXT PRIMARY KEY,
    value         JSONB NOT NULL,
    updated_by    UUID,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value) VALUES
    (
        'auth.password_policy',
        '{
            "minLength": 10,
            "requireLetter": true,
            "requireNumber": true,
            "maxFailedAttempts": 5,
            "lockoutMinutes": 15
        }'::jsonb
    ),
    (
        'auth.token_lifetimes',
        '{
            "accessTokenMinutes": 15,
            "refreshTokenDays": 30,
            "idleTimeoutMinutes": 30,
            "absoluteTimeoutDays": 30
        }'::jsonb
    )
ON CONFLICT (key) DO NOTHING;
