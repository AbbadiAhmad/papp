# Library Module — Librarian Requirements (informational input)

**Status: non-technical domain input, not a binding technical spec.** This document translates and organizes requirements given directly by the librarian (the actual end user of the future Library modules), originally provided in Arabic. Per the instruction that came with it: *do not implement this word-for-word — the actual schema/architecture may differ — but what the librarian sees and experiences in the finished screens should match this intent.* This is input for **Phase 8 and beyond** (`docs/BUILD_PLAN.md`); nothing here is being built yet. Platform-level gaps and open questions this input surfaced are recorded in `docs/DECISIONS.md` (search "Librarian input"), not here — this file is the domain requirements themselves.

Original Arabic request preserved in full at the end of this document (§20) for traceability, since translation always loses some nuance and the librarian may be consulted directly again later.

## 0. Framing

A complete web app for managing a school library (borrowing and reading), Arabic-first with RTL, usable on desktop, tablet, and phone. Must use QR codes and barcodes (USB barcode scanner **and** device camera), full Excel import/export, and report exports. Explicitly requested to be organized and extensible — which is exactly what the base platform (`docs/ARCHITECTURE.md`, `docs/MODULE_SPEC.md`) is for.

**Module boundaries (decided, D44):** `library_catalog` (books, book copies, categories) stands alone as its own module. `library_circulation` (students/staff domain records, borrowing/returning, the scan screen, fines policy) and `library_finance` (financial transactions, payments, receipts) are combined into **one** module, `dependsOn: ["library_catalog"]` — it cannot be installed before its prerequisite. `BUILD_PLAN.md` Phase 8 builds `library_catalog` only; the combined circulation+finance module is planned but not yet phased.

This maps cleanly onto the existing `admin` / `library_assistant` / `finance` / `reader` roles and onto the module manifest's `dependsOn` mechanism (`MODULE_SPEC.md` §2).

## 1. User/role expectations (maps onto existing base-platform roles)

- **Admin**: full user management, manages the whole library domain (books/copies, borrowing/returns, fines, payments), reports, finance access, Excel import/export, backups, system settings. → maps directly to the existing `admin` role plus this module's own permission codes granted to it by default.
- **Librarian/Supervisor** ("المشرفة أو المعلمة"): scans student codes, views a student's file, records borrow/return, scans book codes, records a fine *if granted that permission*, sees her own action history, prints reports she's allowed to. **Cannot**: delete historical records, change system settings, edit financial data unless explicitly granted. → maps to the existing `library_assistant` role. The permission granularity requested here (fine-recording as an optionally-grantable action, not a given) is a good concrete example for this module's `permissions`/`defaultRolePermissions` manifest entries.
- **Finance**: views fines, records payments, issues receipts, tracks unpaid amounts, revenue/fines reports. → maps directly to the existing `finance` role.

No gap here — this is exactly what the base platform's per-module permission system (`MODULE_SPEC.md` §2) was designed for. See `DECISIONS.md` for one open question this raises about **who the "reader" role actually represents** in this domain (see "Students vs. the reader role," below).

## 2. Students / patrons

- Each student needs a unique code, a QR code, and preferably also a barcode.
- Admin can add a student manually, import from Excel, edit student data, print a student card containing the QR/barcode.

**Resolved (D41):** students ARE the platform's `reader` role — real login-capable Users, same account model as everyone else, even though in daily use staff do the scanning on their behalf rather than the student logging in themselves. A user (of any role) can be created by a permitted staff member (as already designed) **or self-register**, gated by a new admin-editable `users.allow_self_registration` setting — this is a genuinely new base-platform capability, built in Phase 5 (see `BUILD_PLAN.md`), not something specific to this module.

## 3. Staff (supervisors/teachers)

- A `Staff` table; the supervisor's name must be recorded on every borrow, return, and fine action.

This is naturally satisfied by the base platform's existing `actor_user_id`/audit-log mechanism (`ARCHITECTURE.md` §8) as long as Staff = platform Users with the `library_assistant` role (see §1) — every mutating action is already attributed to the acting user by the core audit system. No separate "who did this" tracking needs to be invented per-entity; each domain table (Borrowing, Fine, Payment) should still carry its own `performed_by` reference for direct display (e.g. "recorded by Sarah") without needing an audit-log join, but the audit trail itself is already there for free.

## 4–5. Books and copies

Two-table model, exactly as the librarian described:
- `Books` (the catalog record): id, title, author, publisher, category, reading_level, language, description, cover_image, created_at.
- `BookCopies` (each physical copy, since a title can have many copies each individually trackable): qr_code, status, condition, location, acquisition_date.

Copy status values given: `available`, `lost`, `damaged`, `maintenance`, `borrowed`, `reserved`, "…" (explicitly left open — "this can be optimized based on the DB and the modules"). Matches `§33` below.

## 6. The scan screen (described as the most important screen in the program)

A single, very prominent "Scan Code" button. Opening it allows: (1) device camera, (2) USB barcode scanner, (3) manual code entry as a fallback. The system must auto-detect the code type from its prefix: `STU` = student, `STAFF` = supervisor, `BOOK` = book copy, `FINE` = fine.

**Platform-level opportunity, not just a library feature** — see `DECISIONS.md`: since the base platform is meant to host multiple future modules (not just the library), a prefix-dispatch scan capability is a natural **shared platform capability** (one universal scan entry point in the app shell, with modules registering which prefixes they own and what to do with a match) rather than something built once, privately, inside the library module. Recommending this be designed as reusable infrastructure when it's actually built.

## 7. Borrowing flow (wants minimum possible steps)

1. Scan student code (e.g. `STU-000125`) → immediately shows the student's name, class/level, current books, and current-book count (e.g. "1/2").
2. Scan book code (e.g. `BOOK-000458`) → shows the book's title and status ("available").
3. "Confirm Borrow" button → creates a Borrowing record, sets the copy's status to `borrowed`, links it to the student, records the acting staff member, timestamps it, auto-computes the due date, and logs the action in the audit log.

## 8. Borrowing policy — must be settings, not code

Explicitly requested as **admin-editable settings, not hardcoded values**: `maximum_books_per_student` (e.g. 2), `loan_period_days` (e.g. 7), `fine_per_day` (e.g. 1). Admin changes these without touching code.

**This is a direct, concrete instance of a platform-level gap** — see `DECISIONS.md`. The base platform's `system_settings` mechanism (already built in Phase 1, `ARCHITECTURE.md` §6.3) is generic key/value and works fine for *storing* these — the gap is that **only core currently has a way to declare and seed its own settings** (via its own migration's seed rows). There is no manifest-driven way yet for a module like this one to declare "I own these settings keys, with these defaults, editable by whoever holds this permission" the way it already can for permissions and menus. Recorded as a required addition to `MODULE_SPEC.md`.

## 9. Return flow

Staff scans either the student's code or the book's code; scanning the student shows all books currently checked out to them. Shows: book title, borrow date, due date, today's date, days late, and the computed fine. "Complete Return" button: sets the copy back to `available`, records the return date, computes lateness, and auto-creates a fine if the policy requires one.

## 10. Student history ("reading passport")

Opening a student's file shows their info, current book(s), and a **full reading history table** (book, borrow date, return date, status) that is **never deleted**. This is a strong, explicit "never hard-delete history" requirement — consistent with the base platform's own audit-log philosophy (`ARCHITECTURE.md` §8, D26 safe-uninstall) and should be treated as a hard constraint on this module's own domain tables too, not just the audit log.

## 11. Fines

`Fines` and `FineTypes` settings. Example fine types: `FINE-LATE` (late), `FINE-DAMAGE` (damage), `FINE-LOST` (lost), `FINE-OTHER` (other) — each with a code, name, default amount, active flag.

## 12–14. Financial integration

A genuinely separate financial subsystem ("depends on the book and book-browsing modules" — the librarian's own words, matching the `library_finance` module boundary suggested in §0), linked to the library's data: `FinancialTransactions`, `Payments`, `Receipts`. Every fine creates a FinancialTransaction; paying it creates a Payment + Receipt, both with their own unique identifiers.

**Explicit duplicate-prevention rule**: if a fine has already been recorded once for the same student + book + late period + operation, the system must not silently create a second one for the same combination unless the user explicitly confirms it. Every financial transaction must have a unique number.

## 15–17. Excel

**Import**: students, classes, books, book copies, staff — each with a **preview screen before saving**, and if any row is invalid, **nothing is saved** ("all or nothing"), with specific per-row error messages shown (e.g. "Row 25: duplicate student code," "Row 31: class does not exist," "Row 42: book title is empty").

**Resolved (D42):** the preview + per-row-error pattern is now part of the base Users Excel import, built in Phase 2 (`BUILD_PLAN.md`) — kept deliberately simple (a preview endpoint that validates without writing, a commit endpoint that's all-or-nothing) rather than generalized into a shared framework yet. When this module's own five-entity import need actually arrives, it reuses the same simple pattern rather than reinventing it; generalizing into shared framework code is deferred until there's a second real consumer, not built speculatively now.

**Export buttons requested**: students, reading history, borrowings, returns, fines, financial data, staff activity.

**Per-student Excel export**: a single button on a student's file producing one file with three sections — student info, full reading history (incl. which staff member handled each transaction), and fines (incl. payment status/date).

## 18–20. Dashboard & reporting

- A clean statistics dashboard: total students, total books, available/borrowed/overdue counts, unpaid/paid fine totals.
- Reading analytics: most-active readers, most-borrowed books, most-active classes, books-read-per-student, monthly reading counts — filterable by day/week/month/academic year.
- Per-staff activity report: borrow count, return count, fine count, totals, filterable by date range.

## 21. Audit log

Requests exactly the base platform's existing `audit_log` design (`ARCHITECTURE.md` §8): user_id, staff_id, action, entity_type, entity_id, old/new value, timestamp, IP/device where available. Example actions: `BORROW_BOOK`, `RETURN_BOOK`, `CREATE_FINE`, `PAY_FINE`, `ADD_STUDENT`, `UPDATE_STUDENT`. Explicitly: **audit logs must never be deletable from the normal UI.**

No gap — this is already exactly how the base platform's audit system works, including the "not normally deletable" property (the only deletion path is the admin-only, permission-gated, cutoff-capped-at-yesterday manual purge, `ARCHITECTURE.md` §8.4, which is a deliberate, separate, heavily-restricted operation — not a "normal UI" delete button, so it doesn't conflict with this requirement).

## 22. Protection rules the domain logic must enforce

Must prevent: borrowing a copy that's already `borrowed`; borrowing a `lost` copy; returning a copy that wasn't borrowed; a student borrowing beyond their allowed limit; deleting a student who has historical records; deleting a book that has borrowing history; recording a payment larger than the fine amount; recording a payment against an already-fully-paid fine; recording a duplicate fine without explicit confirmation.

These are domain/business-logic invariants for the future circulation and finance modules, not platform gaps — but they reinforce the base platform's existing "validate on the backend, never trust the frontend alone, use DB transactions for multi-step writes" principle (`ARCHITECTURE.md`, general engineering stance already established in this project).

## 23. Notifications

Wants exactly the kind of thing the base platform's core Notification Center (`ARCHITECTURE.md` §12, D20) already provides: "book borrowed successfully," "book returned," "2 days overdue," "a €2 fine was created," "payment recorded," "this book is currently unavailable" — with clear success/warning/error coloring. No gap — this module will just be a **consumer** of the already-core Notifications capability, sending its own category of notifications through it.

## 24. Global search

A search bar reaching: students, student codes, books, book codes, staff, fines, transaction numbers — fast results.

## 25–27. Detail pages

Student dashboard (photo, name, code, class, current book count, historical book count, fines, financial status, then tabs for current books / reading history / fines / financial transactions), Book page (cover, author, category, level, copy counts and availability, borrow history), Copy page (which book, current status, current borrower if any, borrow/due dates).

## 28. Code printing

A "Print Codes" page: choose students/staff/books/fines, select a batch, generate QR, generate barcode, print cards, print book-spine labels.

## 29. UI layout

Sidebar: Home, Scan Code, Borrow, Return, Students, Books, Staff, Fines, Finance, Reports, Settings — collapsing to mobile navigation on phones. The Scan Code screen should be reachable quickly from the header, not buried in navigation.

## 30. Daily-use fast screen ("Quick Library")

A dedicated, minimal screen for staff containing just [Scan Student] then [Scan Book] with an immediate result — the explicit goal being the whole operation takes a few seconds without navigating between many pages.

## 31. Correctness discipline

Every operation must be validated against the real database, not just the frontend — validation must also happen in the backend/database layer. Use database transactions for borrow, return, fine creation, and payment recording, so an interrupted connection can never leave data in an inconsistent state.

Already exactly this project's standing engineering discipline (`ARCHITECTURE.md`, and every phase built so far has been manually verified against a real database, not assumed correct from code review alone) — no gap, just a direct match.

## 33. Status enums

- Borrowing status: `active`, `returned`, `overdue`, `lost`, `cancelled`.
- BookCopy status: `available`, `borrowed`, `lost`, `damaged`, `maintenance`.
- Fine status: `unpaid`, `partially_paid`, `paid`, `waived`, `cancelled`.

## 34. Academic years

The system must support more than one academic year; previous years' data is never deleted. Admin can pick among academic years (e.g. 2025/2026, 2026/2027…), and a student's history persists across years. This is a genuinely new domain concept (an `AcademicYear` entity) that doesn't exist anywhere in the base platform yet, and is specific to this module — not a platform gap, just a note that it needs designing when Phase 8 (or a later `library_circulation` module) is actually scoped.

## 35. Backup

Wants a comprehensive backup/export mechanism (students, books, borrowings, returns, fines, financial data) with historical records never lost across academic years.

**Resolved (D43):** a generic backup/restore capability is deferred — to be added later as its own base-platform feature, not assumed satisfied by per-entity Excel export and not built now. No phase assigned yet.

## 36. Security

Authentication, authorization, "RLS," route protection, input validation, no sensitive data exposed to the frontend, separate permissions for admin/librarian/finance.

**Terminology note, not a new requirement** — see `DECISIONS.md`: "RLS" here is read as a general call for strict role-based access control (which the base platform already provides via `PermissionGuard` + the per-module permission system, `ARCHITECTURE.md` §7) rather than literally requiring Postgres Row-Level-Security policies, since the platform is single-tenant (D29) with no per-row multi-tenant isolation need. Flagged as an assumption to override if literal DB-level RLS was actually intended.

## 37. Non-negotiable engineering quality bar

No permanent mock/fake data, no decorative buttons — every button tied to a real function, every QR scan queries the real database, every borrow/return/fine/payment is genuinely recorded, every action attributable to the user who performed it.

Already exactly how this project has been built phase-by-phase so far (every Developer agent has been required to demonstrate real, verified behavior against a real database before anything is committed) — no gap, a direct match to standing practice.

## 39. Acceptance test scenario (valuable input for this module's future Phase 9 hardening pass)

Create a student → create a staff member → create a book → create a copy → generate the student's QR → generate the book's QR → scan the student → scan the book → borrow the book → attempt to borrow the same copy again and confirm it's rejected → return the book → compute lateness → generate the fine → confirm it appears on the student's file → confirm it appears in finance → record the payment → confirm the fine's status updates to paid → confirm every step appears in the audit log → export the student's record to Excel → confirm nothing was lost.

This maps directly onto `docs/BUILD_PLAN.md`'s Phase 9 (Test hardening) pattern and should be captured as this module's own Phase 9 acceptance scenario when the time comes.

## 40. Definition of success (the librarian's own north star)

*"I'll consider the system successful when, in daily use, the teacher only has to: scan the student's code → see their current book → scan the book code to return it → record the return → scan the new book's code → record the borrow. If there's a delay: the system computes the fine → generates a fine code → links it to the student and book → sends it to the financial record. Everything should be visible on the student's file, in reports, and in Excel — without ever entering the same data manually twice."*

This is the actual product-success bar for whatever the circulation module becomes, worth keeping visible at Phase 8 kickoff rather than letting it dissolve into a feature checklist.

---

## §20 (renumbered from source) — Original Arabic input, preserved verbatim for traceability

The original Arabic text is preserved in the conversation history that produced this document and in the git history of the commit that introduces this file's first version; it is intentionally not duplicated a second time inside this file to keep this document focused and translatable. Consult the originating conversation/commit if the exact original wording is needed for any item above.
