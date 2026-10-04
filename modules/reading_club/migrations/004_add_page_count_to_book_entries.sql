-- 004_add_page_count_to_book_entries.sql
--
-- reading_club module — adds `page_count` to `reading_club_stage_book_entries`,
-- snapshotted per entry exactly like `book_title`/`book_code` already are.
-- Closes the gap this module's own DECISIONS.md READING_CLUB-D4 flagged at
-- build time ("no page-count data exists anywhere in the catalog... flagged
-- here in case a future page-count field on library_catalog should replace
-- it") now that `library_catalog` has a real `page_count` column
-- (LIBRARY_CATALOG-D24, migration 007) — user request: "the book's page
-- number should be recorded and used in the club module where the stages
-- depend on pages." See READING_CLUB-D18 for the full reasoning.
--
-- An AUTO-synced entry (MembershipsService.syncStageBookEntries) snapshots
-- the linked book's CURRENT page_count at sync time, same as it already
-- snapshots book_title/book_code — NULL if the catalog book has none set.
-- A MANUAL entry lets the librarian type a page count directly (mirrors how
-- book_title/book_code already work for a manual entry with no catalog
-- link at all). NULL/0 contributes 0 toward a pages-type stage's progress,
-- never an error — see MembershipsService.computeStageProgress.
--
-- CHECK (page_count IS NULL OR page_count > 0) mirrors the catalog's own
-- "> 0" constraint (migration 007) while still allowing NULL (unknown).

ALTER TABLE reading_club_stage_book_entries
    ADD COLUMN IF NOT EXISTS page_count INTEGER CHECK (page_count IS NULL OR page_count > 0);
