-- 002_add_readable_numbers_and_payment_method.sql
--
-- Closes two real gaps found comparing against the librarian's own
-- (non-technical) description of what she expects to see on screen
-- (docs/LIBRARY_MODULE_REQUIREMENTS.md's companion detailed walkthrough):
--
-- 1) Fines and payments had no human-readable reference number at all (only
--    a UUID `id`) — the librarian's mockup shows "Fine: FINE-000087" /
--    "Payment: PAY-000145" as things she reads and writes down. Sequences
--    (not app-generated random suffixes) give genuinely sequential,
--    gap-free-under-concurrency numbers, formatted by the application layer
--    (`fines.service.ts`) as "<PREFIX>-<6-digit zero-padded nextval>".
--    `library_financial_transactions.transaction_number` /
--    `library_receipts.receipt_number` already existed (random-suffix
--    format) — switched to the same sequence-backed scheme for consistency,
--    no column change needed since they were already free TEXT UNIQUE.
-- 2) `library_payments` had no `payment_method` column at all — the
--    mockup explicitly shows "Payment method: Cash / Card / Transfer".

CREATE SEQUENCE IF NOT EXISTS library_fine_number_seq;
CREATE SEQUENCE IF NOT EXISTS library_transaction_number_seq;
CREATE SEQUENCE IF NOT EXISTS library_payment_number_seq;
CREATE SEQUENCE IF NOT EXISTS library_receipt_number_seq;

ALTER TABLE library_fines ADD COLUMN IF NOT EXISTS fine_number TEXT;
ALTER TABLE library_payments ADD COLUMN IF NOT EXISTS payment_number TEXT;
ALTER TABLE library_payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'card', 'transfer'));

-- Backfill any pre-existing rows (none expected pre-deployment, but the
-- migration must not leave a UNIQUE NOT NULL column full of NULLs on an
-- already-seeded dev database) before enforcing NOT NULL + UNIQUE.
UPDATE library_fines SET fine_number = 'FINE-' || lpad(nextval('library_fine_number_seq')::text, 6, '0') WHERE fine_number IS NULL;
UPDATE library_payments SET payment_number = 'PAY-' || lpad(nextval('library_payment_number_seq')::text, 6, '0') WHERE payment_number IS NULL;

ALTER TABLE library_fines ALTER COLUMN fine_number SET NOT NULL;
ALTER TABLE library_fines ADD CONSTRAINT library_fines_fine_number_key UNIQUE (fine_number);
ALTER TABLE library_payments ALTER COLUMN payment_number SET NOT NULL;
ALTER TABLE library_payments ADD CONSTRAINT library_payments_payment_number_key UNIQUE (payment_number);
