-- 0020_add_session_family_id.sql
--
-- Refresh-token replay detection used to revoke EVERY session of the user, so one
-- stale cookie on one device (a phone that missed a refresh response) signed the
-- user out on all devices. A "family" is one login and the chain of rotations that
-- descend from it; a replay now revokes only its own family (docs/DECISIONS.md D114).
-- Existing rows each get their own family (their rotation chains are unknown),
-- which is the safe direction: a replay of an old token revokes only itself.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS family_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX IF NOT EXISTS user_sessions_family_id_idx ON user_sessions(family_id);
