-- 0004_create_roles_permissions.sql
--
-- Core RBAC tables (see docs/ARCHITECTURE.md §7.1, docs/BUILD_PLAN.md Phase 2,
-- docs/DECISIONS.md D9/D11/D12). Registers the core permission catalog the
-- same conceptual way a module manifest would (code, module_key, category,
-- description_i18n_key) and seeds the 4 base roles (D9) plus a first-cut
-- default grant matrix admins can adjust later from the Permissions page.
--
-- Scope note: this seeds permission codes only for capabilities that
-- actually exist as of Phase 2 (Users/Roles/Permissions/Sessions). Audit,
-- Notifications and ModuleRegistry permission codes are deliberately NOT
-- seeded here even though an earlier draft of BUILD_PLAN.md's Phase 2 list
-- included them — those modules don't exist yet (Phases 3/4/5), and seeding
-- permission codes with no controller anywhere to check them against would
-- leave dangling catalog entries. Each of those phases seeds its own
-- permission codes in its own migration file when it actually builds the
-- guarded endpoints, exactly like a module registering its own permissions
-- at install time.
--
-- INSERT ... ON CONFLICT DO NOTHING keeps this file idempotent SQL in its
-- own right (defense in depth), even though MigrationRunnerService already
-- guarantees a checksum-tracked file is never re-applied.

CREATE TABLE IF NOT EXISTS roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    name_i18n_key   TEXT NOT NULL,
    is_system       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    TEXT NOT NULL UNIQUE,
    module_key              TEXT NOT NULL,
    category                TEXT NOT NULL,
    description_i18n_key    TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS permissions_module_key_idx ON permissions(module_key);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by      UUID,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by     UUID,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles(role_id);

-- --- Seed: the 4 base roles (D9), is_system = true (never deletable) -------

INSERT INTO roles (code, name_i18n_key, is_system) VALUES
    ('admin',              'core.roles.admin',              true),
    ('library_assistant',  'core.roles.library_assistant',  true),
    ('finance',            'core.roles.finance',            true),
    ('reader',             'core.roles.reader',             true)
ON CONFLICT (code) DO NOTHING;

-- --- Seed: the core permission catalog -------------------------------------

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('users.view',            'core', 'users',          'core.perm.users.view'),
    ('users.create',          'core', 'users',          'core.perm.users.create'),
    ('users.update',          'core', 'users',          'core.perm.users.update'),
    ('users.delete',          'core', 'users',          'core.perm.users.delete'),
    ('users.import',          'core', 'users',          'core.perm.users.import'),
    ('users.export',          'core', 'users',          'core.perm.users.export'),
    ('users.settings.view',   'core', 'users_settings', 'core.perm.users.settings.view'),
    ('users.settings.update', 'core', 'users_settings', 'core.perm.users.settings.update'),
    ('roles.view',            'core', 'roles',          'core.perm.roles.view'),
    ('roles.create',          'core', 'roles',          'core.perm.roles.create'),
    ('roles.update',          'core', 'roles',          'core.perm.roles.update'),
    ('roles.delete',          'core', 'roles',          'core.perm.roles.delete'),
    ('roles.assign',          'core', 'roles',          'core.perm.roles.assign'),
    ('permissions.view',      'core', 'permissions',    'core.perm.permissions.view'),
    ('permissions.grant',     'core', 'permissions',    'core.perm.permissions.grant'),
    ('sessions.view',         'core', 'sessions',       'core.perm.sessions.view'),
    ('sessions.revoke',       'core', 'sessions',       'core.perm.sessions.revoke')
ON CONFLICT (code) DO NOTHING;

-- --- Seed: default role -> permission grants (first cut, admin-adjustable) -
--
-- admin: everything in the catalog above.
-- library_assistant: limited user-view only (per BUILD_PLAN.md Phase 2 spirit).
-- finance: none of the user-management set (minimal default).
-- reader: none.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('users.view')
WHERE r.code = 'library_assistant'
ON CONFLICT DO NOTHING;

-- finance and reader intentionally get zero default grants from this
-- migration — an admin can grant more from the Permissions page later.
