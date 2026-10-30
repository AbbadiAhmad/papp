-- 0022_password_reset_tokens.sql
--
-- "Forgot password" by email (docs/DECISIONS.md D122). A person who cannot log in asks for a
-- reset link; the API emails a single-use, short-lived link. Only the SHA-256 of the link token
-- is stored (the token itself exists only inside the email that was sent). Using the link sets a
-- new password and revokes every session of that user.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    requested_ip TEXT
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id, created_at DESC);

-- Admin-tunable (never a hardcoded constant): how long an emailed reset link stays valid.
INSERT INTO system_settings (key, value) VALUES
    ('auth.password_reset', '{ "linkTtlMinutes": 60 }'::jsonb)
ON CONFLICT (key) DO NOTHING;
