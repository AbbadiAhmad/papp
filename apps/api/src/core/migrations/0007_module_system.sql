-- 0007_module_system.sql
--
-- Phase 5 seeds (docs/BUILD_PLAN.md Phase 5, docs/DECISIONS.md D34/D41/D46).
--
-- No new tables: module_registry / module_migrations already exist from
-- 0000_bootstrap_registry.sql and already carry everything the full
-- ModuleRegistryService needs (version, status, manifest_snapshot JSONB) —
-- checked against MODULE_SPEC.md §3 before this phase; nothing to extend.
--
-- Seeds, per D46 ("each phase seeds only its own permission codes"):
--   1. The modules.* permission catalog entries + admin-only default grants
--      (the Modules admin screen is an admin capability by default; any other
--      role can be granted modules.* later from the Permissions page — the
--      grant is data, never a hardcoded role check).
--   2. users.allow_self_registration = false (D41 — self-registration is an
--      admin OPT-IN; POST /auth/register 403s until an admin flips this).
--   3. security.public_endpoint_rate_limit (D34 — the admin-tunable per-IP
--      limit PublicThrottlerGuard reads PER REQUEST for @Public() write
--      endpoints; {limit, windowSeconds} = 10 requests / 60s by default).
--
-- INSERT ... ON CONFLICT DO NOTHING keeps this file idempotent SQL in its
-- own right (defense in depth), matching 0003-0006's style.

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('modules.view',      'core', 'modules', 'core.perm.modules.view'),
    ('modules.install',   'core', 'modules', 'core.perm.modules.install'),
    ('modules.upgrade',   'core', 'modules', 'core.perm.modules.upgrade'),
    ('modules.uninstall', 'core', 'modules', 'core.perm.modules.uninstall')
ON CONFLICT (code) DO NOTHING;

-- admin gets all four by default; every other role gets nothing (an admin
-- can grant modules.view etc. from the Permissions page later).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('modules.view', 'modules.install', 'modules.upgrade', 'modules.uninstall')
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- --- Seed: self-registration switch (D41) -----------------------------------

INSERT INTO system_settings (key, value) VALUES
    ('users.allow_self_registration', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- --- Seed: public-endpoint per-IP rate limit (D34) ---------------------------

INSERT INTO system_settings (key, value) VALUES
    (
        'security.public_endpoint_rate_limit',
        '{ "limit": 10, "windowSeconds": 60 }'::jsonb
    )
ON CONFLICT (key) DO NOTHING;
