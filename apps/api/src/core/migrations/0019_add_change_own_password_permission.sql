-- 0019_add_change_own_password_permission.sql
--
-- Voluntary "change my password" (docs/DECISIONS.md D110). A real,
-- admin-revocable permission like every other self-scoped action (D83),
-- granted to every base role by default. Idempotent.

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('users.password.change_my', 'core', 'users', 'core.perm.users.password.change_my')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'users.password.change_my'
WHERE r.code IN ('admin', 'library_assistant', 'finance', 'reader')
ON CONFLICT DO NOTHING;
