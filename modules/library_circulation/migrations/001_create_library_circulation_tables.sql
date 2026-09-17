-- 001_create_library_circulation_tables.sql
--
-- library_circulation + library_finance (combined module, D44): students,
-- borrow/return, fines, and the finance side (transactions/payments/
-- receipts). See docs/LIBRARY_MODULE_REQUIREMENTS.md for the full domain
-- spec this mirrors. Depends on library_catalog's `library_catalog_book_copies`
-- (manifest `dependsOn`).
--
-- "Staff" (§3) needs no table of its own: a staff member is simply a
-- platform User with the `library_assistant`/`finance` role — every table
-- below that needs "who did this" carries `performed_by`/`created_by`
-- pointing straight at `users(id)`.

CREATE TABLE IF NOT EXISTS library_academic_years (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label       TEXT NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    is_current  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A "student" (§2) is a real, login-capable platform User with the `reader`
-- role (D41) — this table only adds the library-specific fields Users
-- doesn't have. `code` is what gets printed/scanned (prefix STU, §6).
CREATE TABLE IF NOT EXISTS library_students (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL UNIQUE REFERENCES users(id),
    code              TEXT NOT NULL UNIQUE,
    class_name        TEXT,
    academic_year_id  UUID REFERENCES library_academic_years(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_students_code_idx ON library_students (code);

CREATE TABLE IF NOT EXISTS library_fine_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    default_amount  NUMERIC(10, 2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true
);

-- Seed the four fine types the librarian's spec names explicitly (§11).
INSERT INTO library_fine_types (code, name, default_amount, is_active)
VALUES
    ('FINE-LATE', 'Late return', 0, true),
    ('FINE-DAMAGE', 'Damaged book', 0, true),
    ('FINE-LOST', 'Lost book', 0, true),
    ('FINE-OTHER', 'Other', 0, true)
ON CONFLICT (code) DO NOTHING;

-- Full history is NEVER deleted (§10, "reading passport") — no ON DELETE
-- CASCADE from students/copies here on purpose; deleting a student/book with
-- borrowing history is rejected at the service layer (§22), not by a DB FK
-- action, so the protection rule can return a clear error instead of a raw
-- constraint violation.
CREATE TABLE IF NOT EXISTS library_borrowings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_copy_id  UUID NOT NULL REFERENCES library_catalog_book_copies(id),
    student_id    UUID NOT NULL REFERENCES library_students(id),
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'returned', 'overdue', 'lost', 'cancelled')),
    borrowed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at        TIMESTAMPTZ NOT NULL,
    returned_at   TIMESTAMPTZ,
    borrowed_by   UUID NOT NULL REFERENCES users(id),
    returned_by   UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS library_borrowings_student_idx ON library_borrowings (student_id);
CREATE INDEX IF NOT EXISTS library_borrowings_copy_idx ON library_borrowings (book_copy_id);
CREATE INDEX IF NOT EXISTS library_borrowings_status_idx ON library_borrowings (status);

CREATE TABLE IF NOT EXISTS library_fines (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id    UUID NOT NULL REFERENCES library_students(id),
    borrowing_id  UUID REFERENCES library_borrowings(id),
    fine_type_id  UUID NOT NULL REFERENCES library_fine_types(id),
    status        TEXT NOT NULL DEFAULT 'unpaid'
                  CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'waived', 'cancelled')),
    amount        NUMERIC(10, 2) NOT NULL,
    amount_paid   NUMERIC(10, 2) NOT NULL DEFAULT 0,
    notes         TEXT,
    created_by    UUID NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_fines_student_idx ON library_fines (student_id);
CREATE INDEX IF NOT EXISTS library_fines_status_idx ON library_fines (status);

-- Every fine creates exactly one transaction (§12) — the "charge" side of
-- the ledger; `library_payments` below is the "money received" side.
CREATE TABLE IF NOT EXISTS library_financial_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fine_id             UUID NOT NULL REFERENCES library_fines(id),
    transaction_number  TEXT NOT NULL UNIQUE,
    amount              NUMERIC(10, 2) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES library_financial_transactions(id),
    amount          NUMERIC(10, 2) NOT NULL,
    paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_by     UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS library_receipts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id       UUID NOT NULL UNIQUE REFERENCES library_payments(id),
    receipt_number   TEXT NOT NULL UNIQUE,
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
