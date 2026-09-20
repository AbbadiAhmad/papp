# Library Module Improvements — Enhancement Proposal

**Status: Proposed enhancements to `library_catalog` and `library_circulation` modules.**

This document captures refinement requests to improve the user experience and functionality of the existing library modules. These are informed by usage patterns and gaps discovered after the initial implementation.

---

## Overview

The enhancements are organized into four feature areas:

1. **Book Catalog & Copies UI** — streamline copy management and provide better visibility
2. **Book & Copy History** — full audit trail for every copy and its status changes
3. **Reader / Student Experience** — rename, enrich data, show comprehensive history
4. **Borrowing & Return Workflow** — detailed context, notifications, and status tracking on the scan screen

---

## 1. Book Catalog & Copies UI Improvements

### 1.1 Combined Book + Copy Add Flow

**Current state:** Adding a book is a two-step process: create the book, then add copies separately.

**Improvement:** When creating a new book, include fields to add the first copy (or multiple copies) immediately in the same dialog.

**Fields to add to book creation:**
- `qr_code` (for the copy)
- `quantity` (number of copies with the same details)
- `condition` (default: "good")
- `location` (warehouse/shelf)
- `acquisition_date` (default: today)

**Rationale:** Librarians often add a batch of identical copies at once; forcing a second step adds friction.

**Implementation notes:**
- The book creation endpoint already exists; add optional `copies: [{qr_code, quantity, condition, location, acquisition_date}]` to `CreateBookDto`
- Handle the multi-copy case in `BooksService.create()` with a transaction
- Update `BookFormDialog.tsx` to show an optional "Add Copies" collapsible section
- Locale keys: `library_catalog.book.copies_section`, `library_catalog.book.add_copies_label`, etc.

---

### 1.2 Book Catalog List — Available vs. Total Copies

**Current state:** The books table shows only the list of books, no copy information.

**Improvement:** Add two columns to the `BooksListPage` table:
- `Copies (Total)` — count of all copies of this book
- `Copies (Available)` — count of copies with status `available`

**Rationale:** Librarians need quick visibility into stock without clicking into each book. Format: `"2/5"` (2 available out of 5 total).

**Implementation notes:**
- Add computed aggregates to `BooksService.list()` — a subquery on `library_catalog_book_copies` grouped by `book_id`
- Return a DTO shape: `{book, totalCopies, availableCopies}`
- Add table columns in `BooksListPage.tsx`
- Locale key: `library_catalog.column.total_copies`, `library_catalog.column.available_copies`

---

### 1.3 Book Copies — Actions and Status Visibility

**Current state:** Book copies are visible only via `/library/books/:bookId/copies` (a nested list); no actions or status context at a glance.

**Improvement:** Add an "Copies" tab on `BookDetailPage` showing an interactive table with:

**Columns:**
| Column | Purpose |
|--------|---------|
| QR Code | Copy identifier |
| Status | `available`, `borrowed`, `lost`, `damaged`, `maintenance` (with color coding) |
| Condition | From the copy record |
| Location | Shelf/warehouse location |
| Acquisition Date | When added |
| Actions | Menu with: "View History", "Update Status", "Mark Damaged", "Mark Lost" |

**Status badges with colors:**
- `available` → green
- `borrowed` → blue
- `lost` → red
- `damaged` → orange
- `maintenance` → gray

**Rationale:** Provides at-a-glance status without clicking; quick actions for common operations.

**Implementation notes:**
- Already exists as a separate route; surface it as a tab on `BookDetailPage.tsx`
- Add status-color helper to `shared/library.utils.ts`
- Quick-action menu uses existing `updateCopy` endpoint
- Locale keys: `library_catalog.copies_tab`, `library_catalog.copy.status`, etc.

---

## 2. Book & Copy History

### 2.1 Book History (via Circulation Module)

**Current state:** No history view for a book.

**Improvement:** When viewing a book (`BookDetailPage`), show a "History" tab that lists:

**All readers who borrowed this book** — sorted by most recent:

| Date | Reader | Copy | Borrowed | Returned | Status | Days Late | Fine |
|------|--------|------|----------|----------|--------|-----------|------|
| 2026-09-15 | Ahmed Ali | BOOK-0047 | 2026-09-15 | 2026-09-22 | returned | 0 | — |
| 2026-09-08 | Sara Mohamed | BOOK-0045 | 2026-09-08 | — | borrowed | 12 | 12 EGP |

**Requires:** coordination with `library_circulation` module — this is the circulation module's data, displayed in the catalog module's detail page.

**Rationale:** Librarians need to see borrowing history to understand book condition and usage patterns.

**Implementation notes:**
- `library_circulation` module must expose a `GET /api/library/books/:bookId/history` endpoint
- Returns a paginated list of borrowings for that book, populated with reader name/return status
- Add `HistoryTab.tsx` in catalog's `frontend/pages/`
- Requires permission: `library_circulation.borrow` (read history)
- Locale keys: `library_circulation.book_history`, `library_circulation.history_tab`, etc.

---

### 2.2 Copy History (via Circulation Module)

**Current state:** Copy status changes are only recorded in the audit log; no user-facing history.

**Improvement:** When viewing a copy (e.g., by scanning its QR code on the scan page or accessing `/library/books/:bookId/copies/:copyId`), show "Last 10 Actions" with a link to full history.

**Displayed information:**
| Date | Action | Reader | Borrowed | Returned | Status Change | Notes |
|------|--------|--------|----------|----------|----------------|-------|
| 2026-09-22 | Return | Library Assistant | 2026-09-15 | 2026-09-22 | borrowed → available | — |
| 2026-09-15 | Borrow | Library Assistant | 2026-09-15 | — | available → borrowed | — |
| 2026-09-10 | Status Update | Librarian | — | — | available → maintenance | wear on spine |

**Rationale:** When checking why a copy isn't available, librarians need quick context without leaving the page.

**Implementation notes:**
- `library_circulation` exposes `GET /api/library/copies/:copyId/history?limit=10` (default shows 10)
- Returns borrowings + status-change audit entries for that copy
- Display as a collapsible card on `BookDetailPage`'s Copies tab, and on the scan page (§7b)
- Full history link goes to `/library/history/copy/:copyId` in circulation module
- Locale keys: `library_circulation.copy_history`, `library_circulation.last_actions`, etc.

---

## 3. Reader / Student Experience

### 3.1 Rename "Student" to "Reader"

**Current state:** The UI labels the entity "Student".

**Improvement:** Rename throughout to "Reader" to be more inclusive (staff, teachers, or anyone who borrows books).

**Scope:**
- All navigation labels: "Students" → "Readers"
- Page title: "Student Management" → "Reader Management" / "Readers"
- Locale keys: `library_circulation.menu.students` → `library_circulation.menu.readers`, etc.
- Table/dialog headers and field labels

**Rationale:** Makes the system feel more universal and less school-specific.

**Implementation notes:**
- Do NOT rename the database table or entity (`library_students` stays as-is — data model is stable)
- Update all locale files (`ar.json`, `en.json`)
- Update UI components and pages
- Keep the API DTOs named `StudentDto` / `LibraryStudent` for backward compatibility if external integrations exist

---

### 3.2 Reader List & Detail Page — Show More Information

**Current state:** Reader list likely shows basic info (code, name, class); detail page shows borrowings.

**Improvement:** Enrich the reader's detail page with:

**Top-level card:**
- Reader's photo / avatar (if exists)
- Name, Code, Class/Level
- Current borrowing count (e.g., "2/3 books")
- Total fines (paid + unpaid) e.g., "50 EGP unpaid"
- Account status (active, suspended, etc.)

**Tabs:**
1. **Current Books** — what they're borrowing now
   | Copy | Title | Borrowed | Due | Days Late | Status |
   |------|-------|----------|-----|-----------|--------|

2. **Reading History** — full history, never deleted
   | Copy | Title | Borrowed | Returned | Status | Days Late | Fine Created |
   |------|-------|----------|----------|--------|-----------|--------------|

3. **Fines** — all fines (paid, unpaid, waived)
   | Fine # | Type | Amount | Paid | Status | Date Created | Notes |
   |--------|------|--------|------|--------|--------------|-------|

4. **Actions** — what librarians did on this reader's account
   | Date | Action | By | Notes |
   |------|--------|-----|-------|

**Rationale:** Provides full context at a glance without searching multiple screens.

**Implementation notes:**
- Expand `StudentsService.findById()` to return richer DTO with computed fields
- Add tabs to `ReaderDetailPage.tsx` (rename from `StudentDetailPage`)
- History tab is read-only; display `library_borrowings` + computed lateness
- Actions tab shows audit entries for this student's account (create/update/delete operations)
- Locale keys: updated from `student` → `reader` throughout

---

### 3.3 Reader Actions & History

**Current state:** No dedicated "Actions" view for a reader.

**Improvement:** Add an "Actions" section to the reader's detail page showing an audit trail of operations on their account:

**Columns:**
| Date | Action | By | Before | After | Reason |
|------|--------|-----|--------|-------|--------|
| 2026-09-20 | Update | Librarian | class: 5A | class: 5B | — |
| 2026-09-15 | Create | Admin | — | code: READER-0042 | new enrollment |

**Rationale:** Accountability: who changed what and when.

**Implementation notes:**
- Query `audit_log` where `entity_type = 'reader'` AND `entity_id = :readerId`
- Display in a table with before/after diff
- Locale keys: `library_circulation.reader_actions`, `library_circulation.action_history`

---

## 4. Borrowing & Return Workflow — Enhanced Scan Page

### 4.1 Divide Scan Page into Reader and Books Sections

**Current state:** `ScanPage.tsx` has slots for scanning a student and a book in sequence.

**Improvement:** Visually organize the page into two clear sections:

```
┌─────────────────────────────────────────────────────────────────┐
│  Scan Reader / Book                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐            │
│  │  📱 READER SECTION   │  │  📚 BOOK SECTION     │            │
│  │                      │  │                      │            │
│  │ [Scan Reader QR]     │  │ [Scan Book QR]       │            │
│  │ ↓                    │  │ ↓                    │            │
│  │ Name: Ahmed          │  │ Title: Science 101   │            │
│  │ Code: READER-0042    │  │ Copy: BOOK-0047      │            │
│  │ Level: Grade 5B      │  │ Status: Available ✓  │            │
│  │ Borrowed: 2/3        │  │                      │            │
│  │ Fine: 50 EGP         │  │ [View History]       │            │
│  │ [View Borrow History]│  │                      │            │
│  └──────────────────────┘  └──────────────────────┘            │
│                                                                 │
│                         ┌──────────────────┐                   │
│                         │ [Borrow] [Return]│                   │
│                         └──────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

**Rationale:** Clearer visual separation; makes it obvious what action applies where.

**Implementation notes:**
- Refactor `ScanPage.tsx` to use a two-column grid layout
- Each column independently shows scanned data
- Action buttons (Borrow/Return) appear below

---

### 4.2 Reader Section — View Borrow History Button

**Current state:** No quick way to see a reader's borrowing history from the scan page.

**Improvement:** On the reader section (after scanning a reader QR), show a blue "View Borrow History" button that opens a side panel or modal showing:

**Last 10 Borrowings:**
| Copy | Title | Borrowed | Due | Status | Days Late |
|------|-------|----------|-----|--------|-----------|
| BOOK-0045 | Math | 2026-09-08 | 2026-09-15 | Overdue | 5 |
| BOOK-0047 | Science | 2026-09-15 | 2026-09-22 | Active | 0 |

With a "View Full History" link to the reader's detail page (§3.2).

**Rationale:** Context before scanning a book; staff can quickly see if a reader has overdue books or unpaid fines.

**Implementation notes:**
- API call: `GET /api/library/readers/:readerId/borrowings?limit=10`
- Display in a modal/side panel triggered by button
- Link to reader detail page for full history
- Locale key: `library_circulation.view_borrow_history`

---

### 4.3 Book Section — View Copy History Popup

**Current state:** No history visibility for a copy on the scan page.

**Improvement:** On the book section (after scanning a book QR), show a blue "View History" button that opens a popup showing the **last 10 actions** for that copy:

**Format:**
```
Copy: BOOK-0047
Last 10 Actions:

1. [2026-09-22 14:30] Return — Ahmed Ali, Library (marked available)
2. [2026-09-15 08:45] Borrow — Ahmed Ali, Library (marked borrowed)
3. [2026-09-10 16:00] Status Update — Librarian (maintenance → available)
4. ...

[View Full History] → links to `/library/books/:bookId/copies/:copyId/history`
```

**Rationale:** Quick way to see why a copy is not available or has damage/condition issues.

**Implementation notes:**
- API call: `GET /api/library/copies/:copyId/history?limit=10`
- Display in a modal
- "View Full History" link goes to a dedicated copy history page (in circulation module's routes)
- Locale key: `library_circulation.copy_history`, `library_circulation.view_history`

---

### 4.4 Notice: Previous Borrow Indicator

**Current state:** When a librarian scans a reader then a book, there's no indication if they've borrowed it before.

**Improvement:** If a reader has previously borrowed this book (same book, different copy, or same copy), show a notice banner:

**Examples:**
- "ℹ️ Ahmed has borrowed this book before (returned 2026-09-10, no issues)"
- "⚠️ Ahmed is borrowing this book again (returned 2026-09-10, marked damaged)"
- "⚠️ Ahmed is re-borrowing this same copy (last borrow: 2026-09-08–2026-09-15, 3 days late)"

**Rationale:** Gives librarians context; useful for repeated borrowers or damage tracking.

**Implementation notes:**
- After both reader + book are scanned, query: "Has this reader borrowed this exact book (title) before?"
- If yes, fetch the most recent borrowing record and check its status
- Display banner with color/icon (info, warning, error based on previous status)
- Locale keys: `library_circulation.prev_borrow_info`, `library_circulation.prev_borrow_damaged`, etc.

---

## 5. Borrowing Flow Enhancements

### 5.1 Borrow Dialog — Information & Comments Fields

**Current state:** Borrowing probably shows minimal info (copy, reader, confirm button).

**Improvement:** Before confirming a borrow, show a form with:

**Read-Only Information Cards:**
| Field | Source | Default |
|-------|--------|---------|
| Borrow Date | Today | auto-filled, not editable |
| Expected Return Date | Today + loan_policy.loanPeriodDays | auto-filled from settings |
| Copy Status | From book_copies | auto-filled (should be "available") |
| Reader's Current Books | Count | display "2/3", informational |

**Editable Fields:**
- **Comments** (optional textarea) — for librarian notes (e.g., "lender requested 2 extra days") → stored in `library_borrowings.notes` or similar

**Rationale:** Gives librarians a chance to review details and add context before committing.

**Implementation notes:**
- Fetch `loan_policy` setting from `SettingsService`
- Compute expected return: `today + loanPeriodDays`
- Read-only cards use `<TextField disabled />`
- Comments field is a textarea, optional, validated for max length
- Store in a new `library_borrowings.librarian_notes` column (or reuse `notes`)
- Locale keys: `library_circulation.borrow_form`, `library_circulation.borrow_date`, `library_circulation.expected_return_date`, etc.

---

## 6. Return Flow Enhancements

### 6.1 Return Dialog — Information & Status

**Current state:** Return probably shows minimal info and a confirm button.

**Improvement:** When processing a return, show a form with:

**Read-Only Information:**
| Field | Source |
|-------|--------|
| Borrowed Date | From borrowing record |
| Expected Return Date | From borrowing record |
| Actual Return Date | Today (auto) |
| Days Late | Computed: max(0, return_date - due_date) |
| Reader's Current Fine | From fines table (if any) |

**Editable Field:**
- **Return Status** (dropdown) — what condition is the book in?
  - `returned` (default) — returned in normal condition
  - `damaged` — damaged; auto-creates a fine if policy allows
  - `lost` — marked lost; auto-creates a fine
  - `other` — other reason

**Action Buttons:**
- [Complete Return] — marks copy as available, records return
- [Create Fine] (if damaged/lost) — shows fine creation modal, pre-filled with fine type + amount
- [Cancel] — discard

**Rationale:** Context before finalizing; auto-creates fines for damage/loss without extra steps.

**Implementation notes:**
- Fetch `library_borrowings` record for context
- Compute late days: `max(0, today - due_date)`
- Enum for return status: `returned | damaged | lost | other`
- On "damaged" or "lost", suggest fine creation with pre-filled fine type
- Update `library_borrowings.status` to `returned` and `returned_at`
- If damage/loss, create a fine with auto-computed amount from policy
- Update `library_catalog_book_copies.status` to `available` (unless marked lost/damaged, which sets status to `damaged`/`lost`)
- Locale keys: `library_circulation.return_form`, `library_circulation.return_status`, `library_circulation.days_late`, etc.

---

## 7. Implementation Priority & Phases

**Phase A (Foundational):**
- 1.1: Combined Book + Copy Add Flow
- 2.1 / 2.2: Book & Copy History (coordination with circulation)
- 5.1: Borrow Dialog with information

**Phase B (UI Polish):**
- 1.2: Book Catalog — Available vs. Total Copies
- 1.3: Book Copies — Actions and Status
- 4.1: Divide Scan Page
- 6.1: Return Dialog with information & fine creation

**Phase C (Reader Experience):**
- 3.1: Rename Student to Reader
- 3.2: Reader Detail Page enrichment
- 3.3: Reader Actions & History
- 4.2: Borrow History button
- 4.3: Copy History popup
- 4.4: Previous Borrow notice

---

## 8. Locale Files Update

All improvements require locale key additions to both `ar.json` and `en.json`:

**New keys to add:**
- `library_catalog.book.copies_section`, `library_catalog.book.add_copies_label` (1.1)
- `library_catalog.column.total_copies`, `library_catalog.column.available_copies` (1.2)
- `library_catalog.copies_tab`, `library_catalog.copy.status`, `library_catalog.copy.condition`, `library_catalog.copy.location` (1.3)
- `library_circulation.book_history`, `library_circulation.history_tab`, `library_circulation.copy_history`, `library_circulation.last_actions` (2.1 / 2.2)
- `library_circulation.menu.readers`, `library_circulation.reader_detail`, `library_circulation.current_books_tab`, `library_circulation.reading_history_tab`, `library_circulation.fines_tab`, `library_circulation.actions_tab` (3.1 / 3.2 / 3.3)
- `library_circulation.reader_section`, `library_circulation.book_section`, `library_circulation.view_borrow_history`, `library_circulation.view_history` (4.1 / 4.2 / 4.3)
- `library_circulation.prev_borrow_info`, `library_circulation.prev_borrow_damaged` (4.4)
- `library_circulation.borrow_form`, `library_circulation.borrow_date`, `library_circulation.expected_return_date`, `library_circulation.comments` (5.1)
- `library_circulation.return_form`, `library_circulation.return_status`, `library_circulation.days_late`, `library_circulation.create_fine` (6.1)

---

## 9. Testing Strategy

For each improvement, add tests covering:

**Backend (NestJS):**
- Unit tests for new service methods (history queries, stat aggregates)
- E2E tests for new endpoints (permission-gated, audit-logged)

**Frontend (React):**
- Component tests for new dialogs/modals (React Testing Library)
- Integration test: scan reader → scan book → view histories → borrow → return (Playwright)

**Existing tests:**
- Ensure book/copy creation still works with new optional fields (1.1)
- Ensure permission guards on new history endpoints (2.1 / 2.2)
- Ensure reader management still works after rename (3.1)

---

## 10. Summary

These 11 improvements fall into four categories:

1. **Catalog UI** — better visibility + streamlined workflows
2. **History & Audit Trail** — full context for every entity
3. **Reader Experience** — richer, more inclusive interface
4. **Scan Workflow** — detailed forms, notices, quick access to history

All improvements are opt-in enhancements to the existing modules; none break existing functionality or data model (except 3.1, which is a UI-only rename). The majority can be implemented in phases, starting with the highest-value (Phase A).
