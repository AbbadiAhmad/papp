-- 0012_create_backup_permission.sql
--
-- Backup/restore (docs/DECISIONS.md D43 resolution): a core, whole-database
-- feature (pg_dump export via HTTP, pg_restore via a server-side CLI script
-- only — see apps/api/src/core/backup/). No new tables: this feature has no
-- persisted state of its own, only a permission code.
--
-- Single permission `backup.export` gates both GET /backup/info and
-- POST /backup/export (folded into one code — there is no separate "view"
-- action worth its own grant here). Restore has NO permission code at all:
-- it is never reachable over HTTP (see backup.controller.ts's docblock for
-- why), so the actual gate is server/CLI access, not RBAC.
--
-- Granted to admin by default only, matching 0005_create_audit_log.sql's
-- audit.view/audit.purge seed style; other roles get nothing (an admin can
-- grant it later via the Permissions page).

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('backup.export', 'core', 'backup', 'core.perm.backup.export')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'backup.export'
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;
