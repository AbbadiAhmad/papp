-- 008_create_book_files.sql
--
-- library_catalog module — a book's cover picture and book file (LIBRARY_CATALOG-D28).
-- The BYTES live on disk, never in the database:
--   <BOOK_FILES_DIR>/<book id>/cover.<ext>
--   <BOOK_FILES_DIR>/<book id>/book.<ext>
--   <BOOK_FILES_DIR>/<book id>/info.txt
-- This table records what is there (kind, detected type, size) and is what the app trusts. At most one
-- file per kind per book; uploading again replaces it. The uploaded file's own name is deliberately NOT
-- stored. Deleting a book cascades to these rows; the application removes the folder.

CREATE TABLE IF NOT EXISTS library_catalog_book_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id     UUID NOT NULL REFERENCES library_catalog_books (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('cover', 'book')),
    ext         TEXT NOT NULL CHECK (ext ~ '^[a-z0-9]{2,5}$'),
    mime        TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
    uploaded_by UUID NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (book_id, kind)
);
