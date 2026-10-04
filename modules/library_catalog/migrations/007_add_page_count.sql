-- 007_add_page_count.sql
--
-- library_catalog module — records a book's page count on the catalog
-- record itself. User request: "the book's page number should be recorded
-- and used in the club module where the stages depend on pages" — closes
-- the gap `reading_club`'s own DECISIONS.md READING_CLUB-D4 flagged when
-- that module was first built ("library_catalog_books has NO page-count
-- column anywhere on this platform... flagged here in case a future
-- page-count field on library_catalog should replace it; that would be a
-- library_catalog schema change raised with the user first, not something
-- this module should invent unilaterally" — raised with the user now, see
-- LIBRARY_CATALOG-D24 / READING_CLUB-D18).
--
-- Optional (NULL allowed) — matches every other descriptive field on this
-- table (author/publisher/category/...); a book entered before this column
-- existed, or one the librarian hasn't gotten around to filling in yet,
-- simply has no page count until edited. `reading_club` treats a NULL/0
-- page count as "contributes 0 toward a pages-type stage's progress", never
-- an error — the librarian's own manual progress adjustment remains
-- available precisely for this case (see that module's own migration for
-- the matching change).
--
-- CHECK (page_count > 0) mirrors reading_club_stages.target_amount's own
-- "> 0" constraint — a book legitimately has at least one page; 0 would
-- only ever be a data-entry mistake, not a real value worth allowing.

ALTER TABLE library_catalog_books
    ADD COLUMN IF NOT EXISTS page_count INTEGER CHECK (page_count > 0);
