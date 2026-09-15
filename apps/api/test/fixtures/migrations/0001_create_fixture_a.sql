-- Fixture migration for MigrationRunnerService integration tests
-- (apps/api/test/core/migration-runner.integration-spec.ts).
--
-- The INSERT is deliberate: it lets the test prove that re-applying this
-- directory is a true no-op (the sentinel row is not inserted a second
-- time), not merely "the runner didn't throw".

CREATE TABLE IF NOT EXISTS fixture_a (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

INSERT INTO fixture_a (name) VALUES ('sentinel');
