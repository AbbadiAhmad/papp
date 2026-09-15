import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { AppModule } from './app.module';
import { MigrationRunnerService } from './core/module-registry/migration-runner.service';
import { PrismaService } from './prisma/prisma.service';

const logger = new Logger('Bootstrap');

const CORE_MIGRATIONS_DIR = join(__dirname, 'core', 'migrations');
const BOOTSTRAP_MIGRATION_FILENAME = '0000_bootstrap_registry.sql';
const CORE_MODULE_KEY = 'core';
// Bumped by hand as core's own shape changes; this is NOT a package version.
const CORE_MODULE_VERSION = '0.0.1';

/**
 * Guarantees `module_registry` / `module_migrations` exist, using a plain
 * `pg` client rather than Prisma or MigrationRunnerService: on a brand new
 * database neither of those tables exist yet, so there is nothing for
 * MigrationRunnerService to check "already applied" state against, and a
 * Prisma query against a model whose table doesn't exist would just fail.
 *
 * This runs the bootstrap file's CREATE TABLE IF NOT EXISTS statements
 * directly and unconditionally (idempotent, so safe on every boot). It is
 * deliberately NOT how the file gets checksum-tracked — that happens right
 * after, when MigrationRunnerService walks the same directory and finds
 * module_migrations now queryable.
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

async function bootstrap(): Promise<void> {
  logger.log('Bootstrapping module_registry / module_migrations tables...');
  await bootstrapRegistryTables();

  const app = await NestFactory.create(AppModule);
  app.enableCors();

  logger.log(`Applying core migrations from ${CORE_MIGRATIONS_DIR}...`);
  const migrationRunner = app.get(MigrationRunnerService);
  await migrationRunner.applyDirectory(CORE_MIGRATIONS_DIR, CORE_MODULE_KEY);

  logger.log('Seeding core module_registry row (if not already present)...');
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

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  logger.log(`papp API listening on port ${port}`);
}

bootstrap().catch((error) => {
  logger.error('Fatal error during bootstrap', error instanceof Error ? error.stack : error);
  process.exit(1);
});
