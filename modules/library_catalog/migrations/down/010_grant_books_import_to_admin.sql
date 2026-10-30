-- down/010_grant_books_import_to_admin.sql
--
-- Reverses 010: removes the admin grant. The permission row itself belongs to the manifest and is removed with the module.

DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'library_catalog.books.import');
