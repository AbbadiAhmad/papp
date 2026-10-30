-- 011_add_internal_notes.sql
--
-- library_catalog module — staff-only internal notes on books and copies (LIBRARY_CATALOG-D35).
-- The notes are never part of a public or reader-facing response: the API returns them only to callers with
-- `library_catalog.notes.view`, and changing them needs that permission plus the usual books create/update one.
-- This migration also registers that permission and grants it to the roles that already manage books (admin and
-- library_assistant); a module upgrade would otherwise grant it to nobody. Readers and finance get nothing.

ALTER TABLE library_catalog_books       ADD COLUMN IF NOT EXISTS internal_note TEXT;
ALTER TABLE library_catalog_book_copies ADD COLUMN IF NOT EXISTS internal_note TEXT;

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('library_catalog.notes.view', 'library_catalog', 'library_catalog', 'library_catalog.perm.notes.view')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'library_catalog.notes.view'
WHERE r.code IN ('admin', 'library_assistant')
ON CONFLICT DO NOTHING;
