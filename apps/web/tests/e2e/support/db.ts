/**
 * Fixture reset for the Phase 9 Playwright suite. Tier 2 specs need a real,
 * reachable Postgres (docs/TESTING_STRATEGY.md §0) — this shells out to
 * `psql` directly rather than adding a `pg`/Prisma devDependency to
 * apps/web just for test setup. Runs in the Playwright *test process*
 * (Node), never in the browser page.
 *
 * Only ONE fixture needs a reset between runs: the force-password-change
 * account's password actually changes for real during that spec (a genuine
 * server-side mutation, not mocked), so re-running the suite locally would
 * otherwise fail on the second run with stale credentials. Every other
 * fixture (the reader account, the seeded book) is read-only from these
 * specs' point of view.
 */
import { execFileSync } from 'node:child_process';

const PG_HOST = process.env.PGHOST ?? 'localhost';
const PG_USER = process.env.PGUSER ?? 'papp';
const PG_PASSWORD = process.env.PGPASSWORD ?? 'papp';
const PG_DATABASE = process.env.PGDATABASE ?? 'papp';

// argon2id hash of FORCE_PASSWORD_CHANGE_USER.tempPassword ('E2eTemp2026!'),
// generated once with the same `argon2` package apps/api's AuthService uses
// (see this Tester agent's final report for the exact command). Resetting
// to this fixed hash (rather than re-deriving it here) keeps this file free
// of an argon2 devDependency.
const FORCE_PASSWORD_CHANGE_TEMP_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$jl5p/fF42wZG7xQfoNRt6g$XILsvQbkd6QH3P5sx5ScfGdAhE/rUwM7q02eq+XZSUY';

function psql(sql: string): void {
  execFileSync('psql', ['-h', PG_HOST, '-U', PG_USER, '-d', PG_DATABASE, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    stdio: 'pipe',
  });
}

/** Restores pw9e2e.pwchange@papp.local to its seeded "must change" state. */
export function resetForcePasswordChangeFixture(): void {
  psql(
    `UPDATE users SET password_hash = '${FORCE_PASSWORD_CHANGE_TEMP_HASH}', must_change_password = true, ` +
      `failed_login_attempts = 0, locked_until = NULL WHERE email = 'pw9e2e.pwchange@papp.local';`,
  );
}
