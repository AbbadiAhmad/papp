import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { MigrationRunnerService } from '../../src/core/module-registry/migration-runner.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../support/postgres-test-container';

// Tests run as real ESM (see jest.base.config.ts) — no `__dirname` here.
const testDir = fileURLToPath(new URL('.', import.meta.url));
const CORE_MIGRATIONS_DIR = join(testDir, '..', '..', 'src', 'core', 'migrations');
const BOOTSTRAP_MIGRATION_FILENAME = '0000_bootstrap_registry.sql';
const FIXTURE_MIGRATIONS_DIR = join(testDir, '..', 'fixtures', 'migrations');
const FIXTURE_MODULE_KEY = 'fixture_module';

/**
 * Same bootstrap-the-tracking-tables step apps/api/src/main.ts does before
 * MigrationRunnerService can run at all (module_migrations doesn't exist on
 * a brand new database). See main.ts's `bootstrapRegistryTables` doc-comment
 * for the full rationale.
 */
async function bootstrapRegistryTables(): Promise<void> {
  const sql = readFileSync(join(CORE_MIGRATIONS_DIR, BOOTSTRAP_MIGRATION_FILENAME), 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function countFixtureARows(prisma: PrismaService): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>('SELECT count(*)::bigint AS count FROM fixture_a');
  return Number(rows[0].count);
}

/**
 * The most important test in Phase 0 (per docs/BUILD_PLAN.md, Tester scope):
 * this is the mechanism every later module install/upgrade depends on.
 * Against a throwaway Testcontainers Postgres 16 container:
 *  (a) applying a fixture migration directory records every file in
 *      module_migrations and actually executes the SQL,
 *  (b) re-applying the same directory is a true no-op — no duplicate rows,
 *      and (proven via a sentinel INSERT) no re-execution, not just "no
 *      thrown error",
 *  (c) editing an already-applied file (in a temp copy — the checked-in
 *      fixtures are never mutated) makes MigrationRunnerService throw a
 *      checksum-mismatch error instead of silently re-applying or skipping.
 *
 * The three tests share one container/DB and run in the declared order —
 * (b) and (c) depend on state left behind by (a).
 */
describe('MigrationRunnerService (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let runner: MigrationRunnerService;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    await bootstrapRegistryTables();
    prisma = new PrismaService();
    await prisma.$connect();
    runner = new MigrationRunnerService(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopPostgresTestContainer(container);
  });

  it('applies every fixture migration and records each one in module_migrations', async () => {
    await runner.applyDirectory(FIXTURE_MIGRATIONS_DIR, FIXTURE_MODULE_KEY);

    const rows = await prisma.moduleMigration.findMany({
      where: { moduleKey: FIXTURE_MODULE_KEY },
      orderBy: { filename: 'asc' },
    });
    expect(rows.map((r) => r.filename)).toEqual(['0001_create_fixture_a.sql', '0002_create_fixture_b.sql']);
    expect(rows.every((r) => typeof r.checksum === 'string' && r.checksum.length === 64)).toBe(true);

    await expect(countFixtureARows(prisma)).resolves.toBe(1);
  });

  it('is a no-op re-applying the same directory: no duplicate rows, no re-execution', async () => {
    await runner.applyDirectory(FIXTURE_MIGRATIONS_DIR, FIXTURE_MODULE_KEY);

    const rows = await prisma.moduleMigration.findMany({ where: { moduleKey: FIXTURE_MODULE_KEY } });
    expect(rows).toHaveLength(2);

    // Proves 0001's INSERT did not run a second time — a weaker test could
    // pass here just because applyDirectory() didn't throw.
    await expect(countFixtureARows(prisma)).resolves.toBe(1);
  });

  it('throws a checksum-mismatch error when an already-applied migration file is edited', async () => {
    const tamperedDir = mkdtempSync(join(tmpdir(), 'papp-migration-tamper-'));
    try {
      cpSync(FIXTURE_MIGRATIONS_DIR, tamperedDir, { recursive: true });
      const tamperedFile = join(tamperedDir, '0001_create_fixture_a.sql');
      writeFileSync(tamperedFile, `${readFileSync(tamperedFile, 'utf8')}\n-- tampered after being applied\n`);

      await expect(runner.applyDirectory(tamperedDir, FIXTURE_MODULE_KEY)).rejects.toThrow(/checksum mismatch/i);

      // The original, checked-in fixture file is untouched by this test.
      const original = readFileSync(join(FIXTURE_MIGRATIONS_DIR, '0001_create_fixture_a.sql'), 'utf8');
      expect(original).not.toMatch(/tampered/);
    } finally {
      rmSync(tamperedDir, { recursive: true, force: true });
    }
  });
});
