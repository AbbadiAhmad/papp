-- 004_create_book_ratings_table.sql
--
-- Feature: reader/staff book ratings (LIBRARY_CATALOG-D20) — 1-5 stars plus
-- an optional written review, gated by the new `library_catalog.books.rate`
-- permission (grantable to any role, not hardcoded to "reader"). One rating
-- per (book, user), editable — re-rating UPDATEs the same row rather than
-- creating a second one. Deleting a book cascades to its ratings (same
-- "a rating cannot outlive its book" rule copies already follow).

CREATE TABLE IF NOT EXISTS library_catalog_book_ratings (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id    UUID NOT NULL REFERENCES library_catalog_books(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id),
    rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (book_id, user_id)
);
CREATE INDEX IF NOT EXISTS library_catalog_book_ratings_book_idx ON library_catalog_book_ratings (book_id);
