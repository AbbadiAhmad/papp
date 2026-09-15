import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { MigrationRunnerService } from '../../src/core/module-registry/migration-runner.service';
import { PrismaService } from '../../src/prisma/prisma.service';

// Tests run as real ESM (see jest.base.config.ts) — no `__dirname` here.
const testSupportDir = fileURLToPath(new URL('.', import.meta.url));
const CORE_MIGRATIONS_DIR = join(testSupportDir, '..', '..', 'src', 'core', 'migrations');
const BOOTSTRAP_MIGRATION_FILENAME = '0000_bootstrap_registry.sql';
const CORE_MODULE_KEY = 'core';
const CORE_MODULE_VERSION = '0.0.1';

/**
 * Mirrors apps/api/src/main.ts's `bootstrap()` steps — bootstrap the
 * module_registry/module_migrations tables, build the Nest app, apply core
 * migrations, seed the `core` module_registry row — minus the final
 * `app.listen()`, so e2e specs exercise a fully-booted app wired exactly
 * like production against a throwaway Testcontainers Postgres.
 *
 * Deliberately duplicated rather than imported: main.ts doesn't export a
 * reusable bootstrap function, and it's Developer-owned code that Tester
 * scope for this phase does not modify (see docs/BUILD_PLAN.md, Phase 0
 * task description). If main.ts's bootstrap steps change, this needs a
 * matching update.
 *
 * Requires process.env.DATABASE_URL to already point at a running Postgres
 * — call startPostgresTestContainer() first.
 */
export async function createTestApp(): Promise<INestApplication> {
  await bootstrapRegistryTables();

  const app = await NestFactory.create(AppModule, { logger: false });

  const migrationRunner = app.get(MigrationRunnerService);
  await migrationRunner.applyDirectory(CORE_MIGRATIONS_DIR, CORE_MODULE_KEY);

  const prisma = app.get(PrismaService);
  await prisma.moduleRegistryEntry.upsert({
    where: { key: CORE_MODULE_KEY },
    update: {},
    create: {
      key: CORE_MODULE_KEY,
      version: CORE_MODULE_VERSION,
      status: 'installed',
      installedAt: new Date(),
    },
  });

  await app.init();
  return app;
}

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
