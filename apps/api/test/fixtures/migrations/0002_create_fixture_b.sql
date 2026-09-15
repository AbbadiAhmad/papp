-- Second fixture migration for MigrationRunnerService integration tests.
-- Trivial and data-free; exists to prove multiple files in one directory
-- are all applied, in filename order, in a single applyDirectory() call.

CREATE TABLE IF NOT EXISTS fixture_b (
    id    SERIAL PRIMARY KEY,
    value TEXT
);
