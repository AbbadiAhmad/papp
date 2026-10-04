-- 0013_add_self_registration_role_code.sql
--
-- Resolves a bug found while fixing D90 (self-registration had no reachable
-- frontend): AuthService.register() hardcoded the new user's role to the
-- literal string "reader" — a Library-module-specific role baked into CORE
-- auth code, left over from before Library was split out as an installable
-- module (CLAUDE.md: "papp" is a general back-office platform; Library is
-- just the first module built on top, not a core assumption).
--
-- Adds `users.self_registration_role_code` to system_settings: the role
-- code self-registered accounts are assigned, admin-configurable from the
-- same Settings -> Self-Registration tab as the on/off toggle (D41).
-- Default is JSON null ("not configured yet") — AuthService.register()
-- rejects with a clear error until an admin picks a real role, rather than
-- silently falling back to a role that may not even exist in a given
-- deployment (every deployment's actual role set is operator-defined
-- beyond the four seeded base roles).

INSERT INTO system_settings (key, value) VALUES
    ('users.self_registration_role_code', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;
