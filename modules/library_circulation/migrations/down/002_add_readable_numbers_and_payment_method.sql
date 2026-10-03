-- down/002_add_readable_numbers_and_payment_method.sql
--
-- Reverses 002_add_readable_numbers_and_payment_method.sql: drops the
-- UNIQUE constraints and columns it added to library_fines/library_payments,
-- then drops the four sequences it created. Constraint names are the exact
-- ones the up-migration itself declared (library_fines_fine_number_key /
-- library_payments_payment_number_key) — dropping the column with CASCADE
-- semantics via DROP COLUMN already removes its own constraint, but the
-- payment_method CHECK is inline (unnamed) so it goes with its column too;
-- the two named UNIQUE constraints are dropped explicitly first for clarity
-- and so this stays correct even if a future edit reorders these statements.

ALTER TABLE IF EXISTS library_fines
    DROP CONSTRAINT IF EXISTS library_fines_fine_number_key;
ALTER TABLE IF EXISTS library_payments
    DROP CONSTRAINT IF EXISTS library_payments_payment_number_key;

ALTER TABLE IF EXISTS library_fines
    DROP COLUMN IF EXISTS fine_number;
ALTER TABLE IF EXISTS library_payments
    DROP COLUMN IF EXISTS payment_number,
    DROP COLUMN IF EXISTS payment_method;

DROP SEQUENCE IF EXISTS library_fine_number_seq;
DROP SEQUENCE IF EXISTS library_transaction_number_seq;
DROP SEQUENCE IF EXISTS library_payment_number_seq;
DROP SEQUENCE IF EXISTS library_receipt_number_seq;
