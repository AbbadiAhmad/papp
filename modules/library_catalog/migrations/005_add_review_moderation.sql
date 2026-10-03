-- 005_add_review_moderation.sql
--
-- Feature: "the librarian has to approve the comments to publish it"
-- (LIBRARY_CATALOG-D21). The star RATING always counts toward the average
-- immediately — only the written REVIEW text needs approval before it's
-- shown to anyone besides its own author. `review_status` defaults to
-- 'approved' so a rating with no review text needs no moderation at all;
-- BooksService.rateBook() resets it to 'pending' whenever the review text
-- is actually set/changed.

ALTER TABLE library_catalog_book_ratings
    ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    ADD COLUMN moderated_by UUID REFERENCES users(id),
    ADD COLUMN moderated_at TIMESTAMPTZ;

CREATE INDEX library_catalog_book_ratings_review_status_idx ON library_catalog_book_ratings (review_status);
