-- 006_add_student_code_sequence.sql
--
-- Auto-generated, incremental reader codes (STU000001, STU000002, ...) —
-- same approach as library_catalog's copy-code sequence (006_add_copy_code_
-- sequence.sql there): a Postgres SEQUENCE consulted only when the librarian
-- leaves the code blank; a manually typed code is still accepted and the
-- application fast-forwards the sequence past it (StudentsService).
--
-- Deliberately NOT a column DEFAULT — `code` stays plain TEXT UNIQUE so
-- hand-typed legacy codes (e.g. "STU-001") keep working untouched.

CREATE SEQUENCE IF NOT EXISTS library_students_code_seq AS BIGINT START WITH 1;

-- Start past any existing code that already follows the STU<digits> format,
-- so the first suggestion on an install with data never collides.
DO $$
DECLARE
    highest BIGINT;
BEGIN
    SELECT MAX(substring(code FROM '^STU([0-9]+)$')::BIGINT)
      INTO highest
      FROM library_students
     WHERE code ~ '^STU[0-9]+$';
    IF highest IS NOT NULL THEN
        PERFORM setval('library_students_code_seq', highest, true);
    END IF;
END $$;
