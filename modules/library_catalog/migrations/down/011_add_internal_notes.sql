-- down/011_add_internal_notes.sql
--
-- Reverses 011: drops the note columns (the notes are lost) and the role grants of the permission.

DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'library_catalog.notes.view');

ALTER TABLE library_catalog_books       DROP COLUMN IF EXISTS internal_note;
ALTER TABLE library_catalog_book_copies DROP COLUMN IF EXISTS internal_note;
