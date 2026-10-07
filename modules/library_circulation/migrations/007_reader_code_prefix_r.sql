-- 007_reader_code_prefix_r.sql
--
-- Auto-generated reader codes switch from STU<digits> to R<digits> (R000001,
-- R000002, ...). Existing codes (STU..., hand-typed) are left untouched —
-- they stay valid and scannable. Re-point the shared sequence at the highest
-- existing R<digits> code, or restart it at 1 when there is none yet.

DO $$
DECLARE
    highest BIGINT;
BEGIN
    SELECT MAX(substring(code FROM '^R([0-9]+)$')::BIGINT)
      INTO highest
      FROM library_students
     WHERE code ~ '^R[0-9]+$';
    IF highest IS NOT NULL THEN
        PERFORM setval('library_students_code_seq', highest, true);
    ELSE
        PERFORM setval('library_students_code_seq', 1, false);
    END IF;
END $$;
