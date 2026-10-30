-- 010_grant_books_import_to_admin.sql
--
-- library_catalog module — the Import button on the Books page (LIBRARY_CATALOG-D31/D32) needs the permission
-- `library_catalog.books.import`. A module upgrade registers a new permission but, by platform rule, grants it to
-- nobody, so an existing installation's admin could not see Import at all. This migration registers the permission
-- (the upgrade's own registration then finds it and skips it) and grants it to the `admin` role only — the same
-- approach core migration 0021 uses for `notifications.confirmations.view`. Other roles are granted it by an admin
-- on the Permissions page. Idempotent; a revoke made later is not re-applied because this file runs once.

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('library_catalog.books.import', 'library_catalog', 'library_catalog', 'library_catalog.perm.books.import')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'library_catalog.books.import'
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;
