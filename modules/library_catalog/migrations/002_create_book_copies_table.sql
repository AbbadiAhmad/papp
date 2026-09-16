-- 002_create_book_copies_table.sql
--
-- library_catalog module — physical, individually-trackable copies of a
-- Book (docs/LIBRARY_MODULE_REQUIREMENTS.md §5: qr_code, status, condition,
-- location, acquisition_date). `status` is a real Postgres ENUM (not a CHECK
-- on TEXT), same lesson core's own 0000/0005 migrations already applied for
-- Prisma enum mapping. §5's status list is `available | lost | damaged |
-- maintenance | borrowed | reserved`, explicitly "left open... can be
-- optimized" — the enum can grow with a future migration (ALTER TYPE ...
-- ADD VALUE) without breaking this one, per D16's append-only migration rule.
--
-- Borrowing/returning/fines themselves are the future library_circulation +
-- library_finance module's job (D44) — this table only tracks a copy's
-- CURRENT status, not the borrowing history that changes it. Deleting a book
-- cascades to its copies (a copy cannot outlive the title it belongs to);
-- the future circulation module is responsible for ever blocking that
-- delete when a copy has borrowing history (§22 of the requirements doc) —
-- out of this module's scope per D44.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'library_catalog_book_copy_status') THEN
        CREATE TYPE library_catalog_book_copy_status AS ENUM (
            'available',
            'borrowed',
            'lost',
            'damaged',
            'maintenance',
            'reserved'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS library_catalog_book_copies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id             UUID NOT NULL REFERENCES library_catalog_books(id) ON DELETE CASCADE,
    qr_code             TEXT NOT NULL UNIQUE,
    status              library_catalog_book_copy_status NOT NULL DEFAULT 'available',
    condition           TEXT,
    location            TEXT,
    acquisition_date    DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_catalog_book_copies_book_id_idx ON library_catalog_book_copies (book_id);
CREATE INDEX IF NOT EXISTS library_catalog_book_copies_status_idx ON library_catalog_book_copies (status);
