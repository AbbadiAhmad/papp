-- 009_create_book_images.sql
--
-- library_catalog module — extra pictures of a book (LIBRARY_CATALOG-D30). The cover (migration 008) stays the
-- single main picture; this table holds the additional gallery pictures, any number up to the application's
-- per-book limit. Bytes live on disk: <BOOK_FILES_DIR>/<book id>/images/<image id>.<ext>. The uploaded file's
-- own name is never stored. Deleting a book cascades to these rows; the application removes the folder.

CREATE TABLE IF NOT EXISTS library_catalog_book_images (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id     UUID NOT NULL REFERENCES library_catalog_books (id) ON DELETE CASCADE,
    ext         TEXT NOT NULL CHECK (ext ~ '^[a-z0-9]{2,5}$'),
    mime        TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
    uploaded_by UUID NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_catalog_book_images_book_idx ON library_catalog_book_images (book_id, created_at);
