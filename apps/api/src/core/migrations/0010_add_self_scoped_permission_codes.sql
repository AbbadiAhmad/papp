-- 0010_add_self_scoped_permission_codes.sql
--
-- Closes a real gap flagged by the user: several self-scoped, "logged in is
-- enough" endpoints (GET /sessions/me, GET /users/me/landing-page-options,
-- PATCH /users/me/landing-page) had NO permission gate at all — unlike
-- notifications.view (migration 0006), which is a real, admin-grantable/
-- revocable code seeded to every base role, these had no code to revoke.
-- Every authenticated page/action must sit under the permission umbrella;
-- only genuinely `@Public()` anonymous routes (login, setup, a module's own
-- public shareable links) are exempt, per the user's explicit instruction.
--
-- Two endpoints stay intentionally exempt and are NOT given a code here —
-- gating them would be circular, not an oversight: GET /users/me and GET
-- /users/me/permissions are the bootstrap calls that TELL the app what a
-- user may do; POST /auth/logout and POST /auth/force-password-change must
-- always work regardless of any grant (force-password-change is reachable
-- specifically WHILE mustChangePassword blocks every other endpoint).
--
-- Also adds permissions.view_my: a NEW self-scoped "My Permissions" view
-- (GET /permissions/me) distinct from the full admin matrix (GET
-- /permissions, permissions.view) — a user sees only their own effective
-- grants, never every role's.
--
-- INSERT ... ON CONFLICT DO NOTHING keeps this idempotent, matching every
-- other migration's style (0004/0005/0006).

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('sessions.view_my',            'core', 'sessions',    'core.perm.sessions.view_my'),
    ('users.preferences.view_my',   'core', 'users',       'core.perm.users.preferences.view_my'),
    ('users.preferences.update_my', 'core', 'users',       'core.perm.users.preferences.update_my'),
    ('permissions.view_my',         'core', 'permissions', 'core.perm.permissions.view_my')
ON CONFLICT (code) DO NOTHING;

-- admin: all four (matching 0006's grant style).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'sessions.view_my', 'users.preferences.view_my', 'users.preferences.update_my', 'permissions.view_my'
)
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- All four go to EVERY base role by default — these are exactly the
-- "manage my own account" actions every role already relied on working
-- unconditionally before this migration; making them real codes (rather
-- than a hardcoded no-check) means an admin CAN now revoke one from a
-- custom role, which the old ungated behavior could never express.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'sessions.view_my', 'users.preferences.view_my', 'users.preferences.update_my', 'permissions.view_my'
)
WHERE r.code IN ('library_assistant', 'finance', 'reader')
ON CONFLICT DO NOTHING;
