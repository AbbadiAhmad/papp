import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Starts a throwaway Postgres 16 container for one integration/e2e test file
 * and points DATABASE_URL — the same env var apps/api/src/main.ts,
 * PrismaService, and MigrationRunnerService's plain `pg` client all read at
 * call time — at it. Call stopPostgresTestContainer in an `afterAll` to tear
 * it down.
 *
 * Requires a reachable Docker daemon. In this sandbox, pulling
 * `postgres:16-alpine` from Docker Hub is blocked by the egress proxy policy
 * (403 on the CloudFront-backed blob host) — see the Tester Phase 0 report
 * in the PR for the exact failure captured locally. This is written to run
 * for real once Docker/image-pull access is available (e.g. in CI, wired up
 * in Phase 7).
 */
export async function startPostgresTestContainer(): Promise<StartedPostgreSqlContainer> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  return container;
}

export async function stopPostgresTestContainer(container: StartedPostgreSqlContainer | undefined): Promise<void> {
  if (container) {
    await container.stop();
  }
}
