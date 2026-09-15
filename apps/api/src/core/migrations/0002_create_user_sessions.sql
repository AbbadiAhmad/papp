-- 0002_create_user_sessions.sql
--
-- Core `user_sessions` table (see docs/BUILD_PLAN.md §2, ARCHITECTURE.md
-- §6.1). One row per issued refresh token / session. `id` doubles as the
-- JWT `sid` claim. `refresh_token_hash` is a sha256 hex digest of the
-- opaque refresh token, never the raw token itself.

CREATE TABLE IF NOT EXISTS user_sessions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash    TEXT NOT NULL,
    issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ NOT NULL,
    ip_address            TEXT,
    user_agent            TEXT,
    geo_location          JSONB,
    revoked_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_refresh_token_hash_key ON user_sessions(refresh_token_hash);
