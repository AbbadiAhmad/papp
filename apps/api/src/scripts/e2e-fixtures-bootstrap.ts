import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { AppModule } from '../app.module';
import { MigrationRunnerService } from '../core/module-registry/migration-runner.service';
import { ModuleRegistryService } from '../core/module-registry/module-registry.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Playwright Tier 2 fixture bootstrap (docs/BUILD_PLAN.md Phase 9,
 * docs/TESTING_STRATEGY.md §1, D59-follow-up) — TEST-ONLY, never imported or
 * invoked by any production code path (main.ts does not reference this
 * file). Compiled into `dist/scripts/` alongside real app code only because
 * NestJS's DI needs `emitDecoratorMetadata`, which the fast esbuild-based
 * runners already used elsewhere in this repo (`tsx`, for `npm run
 * lint:*`/`scripts/*.ts`) do NOT support — the same real `tsc` build
 * apps/api already ships is the only correct way to run this against
 * `AppModule`'s real DI graph.
 *
 * `apps/web/playwright.config.ts`'s api `webServer.command` runs this
 * BEFORE starting the real long-running `node dist/main.js` process:
 *
 *   npm run build && node dist/scripts/e2e-fixtures-bootstrap.js && node dist/main.js
 *
 * D15 (no hot-swap — a module only mounts at NestFactory time, never
 * in-process) means installing `library_catalog` AFTER `main.ts`'s own
 * `node dist/main.js` is already listening would never make its routes
 * appear for that already-running process. Running this script BEFORE that
 * final `node dist/main.js` guarantees the module (and the fixture users the
 * frontend specs log in as) already exist in the database by the time that
 * real, Playwright-health-checked process boots and calls its own
 * `discoverInstalledModules()`.
 *
 * Idempotent end to end (every step upserts / checks-before-inserting), so
 * it's safe to run against a long-lived local dev database (this sandbox's
 * own Postgres — a no-op on the second and every subsequent run) as well as
 * a genuinely fresh one-off CI Postgres container.
 *
 * Reuses the exact same real code every other Tier 2 layer already proved
 * out — `ModuleRegistryService.install()` (Phase 8's real, already-shipped
 * admin install flow; requires no LibraryCatalogModule DI wiring at all,
 * confirmed by reading module-registry.service.ts — install() only touches
 * PrismaService/MigrationRunnerService/I18nService, reading the module's
 * manifest.json + migrations straight off disk) and the same core-bootstrap
 * steps `main.ts` itself runs on every boot (kept in sync deliberately;
 * duplicated rather than imported because main.ts's own `bootstrap()` is not
 * an exported, reusable function — see its own file).
 */

const logger = new Logger('E2eFixturesBootstrap');

const CORE_MIGRATIONS_DIR = join(__dirname, '..', 'core', 'migrations');
const BOOTSTRAP_MIGRATION_FILENAME = '0000_bootstrap_registry.sql';
const CORE_MODULE_KEY = 'core';
const CORE_MODULE_VERSION = '0.0.1';
const LIBRARY_CATALOG_KEY = 'library_catalog';

// Mirrors apps/web/tests/e2e/support/test-data.ts exactly — this is the one
// place both sides of the fixture contract (what gets seeded, what the specs
// expect) must be kept in lockstep; a mismatch here fails every frontend
// Tier 2 spec loudly, not silently.
const READER_FIXTURE = { email: 'pw9e2e.reader@papp.local', name: 'Phase9 E2E Reader', password: 'E2eReader2026!' };
const PWCHANGE_FIXTURE = {
  email: 'pw9e2e.pwchange@papp.local',
  name: 'Phase9 E2E ForcePwChange',
  tempPassword: 'E2eTemp2026!',
};
const SEEDED_BOOK_TITLE = 'Phase9 E2E Smoke Test Book';

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

async function ensureFixtureUser(
  prisma: PrismaService,
  fixture: { email: string; name: string },
  password: string,
  mustChangePassword: boolean,
  roleCode: string,
): Promise<void> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: fixture.email },
    update: { passwordHash, mustChangePassword, isActive: true, failedLoginAttempts: 0, lockedUntil: null },
    create: { email: fixture.email, name: fixture.name, passwordHash, mustChangePassword },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
}

async function main(): Promise<void> {
  logger.log('Bootstrapping module_registry/module_migrations tables...');
  await bootstrapRegistryTables();

  // Deliberately NOT `{ logger: false }` — Nest's Logger silences ALL
  // instances process-wide when that option is set (including this file's
  // own `logger`, confirmed empirically: only the one log line emitted
  // BEFORE `createApplicationContext` ran ever printed with it set), which
  // would make a failed CI run of this script much harder to diagnose.
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    logger.log(`Applying core migrations from ${CORE_MIGRATIONS_DIR}...`);
    const migrationRunner = app.get(MigrationRunnerService);
    await migrationRunner.applyDirectory(CORE_MIGRATIONS_DIR, CORE_MODULE_KEY);

    const prisma = app.get(PrismaService);
    await prisma.moduleRegistryEntry.upsert({
      where: { key: CORE_MODULE_KEY },
      update: {},
      create: { key: CORE_MODULE_KEY, version: CORE_MODULE_VERSION, status: 'installed', installedAt: new Date() },
    });

    const libraryCatalogEntry = await prisma.moduleRegistryEntry.findUnique({ where: { key: LIBRARY_CATALOG_KEY } });
    if (libraryCatalogEntry?.status === 'installed') {
      logger.log('library_catalog already installed — skipping install.');
    } else {
      logger.log('Installing library_catalog (real ModuleRegistryService.install() flow)...');
      const moduleRegistry = app.get(ModuleRegistryService);
      await moduleRegistry.install(LIBRARY_CATALOG_KEY);
    }

    logger.log('Seeding Playwright Tier 2 fixture users...');
    await ensureFixtureUser(prisma, READER_FIXTURE, READER_FIXTURE.password, false, 'reader');
    // Seeded WITH must_change_password = true every run — apps/web/tests/e2e/support/db.ts's
    // resetForcePasswordChangeFixture() also restores this between local
    // re-runs, but re-asserting it here too means a fresh CI database needs
    // no separate reset step on its very first run.
    await ensureFixtureUser(prisma, PWCHANGE_FIXTURE, PWCHANGE_FIXTURE.tempPassword, true, 'reader');

    logger.log('Seeding Playwright Tier 2 fixture book...');
    const existingBook = await prisma.$queryRaw<
      { id: string }[]
    >`SELECT id FROM library_catalog_books WHERE title = ${SEEDED_BOOK_TITLE} LIMIT 1`;
    if (existingBook.length === 0) {
      await prisma.$executeRaw`INSERT INTO library_catalog_books (title) VALUES (${SEEDED_BOOK_TITLE})`;
    }

    logger.log('Playwright Tier 2 fixture bootstrap complete.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  logger.error('Fatal error during e2e fixture bootstrap', error instanceof Error ? error.stack : error);
  process.exit(1);
});
