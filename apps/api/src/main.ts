import 'reflect-metadata';
import { DynamicModule, ForwardReference, Logger, Module, Type, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { AppModule } from './app.module';
import { discoverInstalledModules } from './core/module-registry/module-loader';
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

/**
 * Builds the actual root module Nest boots from: `AppModule` (all of core)
 * plus whatever `discoverInstalledModules()` found. Nest's `@Module(...)` is
 * just a decorator FUNCTION under the hood — calling it directly against a
 * throwaway class is the standard way to assemble a module list that isn't
 * known until runtime (D15: modules mount at boot, never hot-swapped into
 * an already-running app).
 */
type NestImport = Type<unknown> | DynamicModule | ForwardReference | Promise<DynamicModule>;

function buildRootModule(discoveredModuleClasses: unknown[]): Type<unknown> {
  class RootModule {}
  Module({ imports: [AppModule, ...(discoveredModuleClasses as NestImport[])] })(RootModule);
  return RootModule;
}

/**
 * Applies `TRUST_PROXY` (see `.env.example`) ONLY when the env var is set —
 * this is what makes `PublicThrottlerGuard`'s per-IP resolution correct
 * behind the docker-compose `web` nginx reverse proxy in a real deployment,
 * while staying safe for direct/dev access (an unset TRUST_PROXY means
 * Express never trusts a caller-supplied X-Forwarded-For header, so a direct
 * caller can't spoof their IP to dodge the per-IP throttle).
 */
function applyTrustProxy(app: NestExpressApplication): void {
  const raw = process.env.TRUST_PROXY;
  if (!raw) return;

  let value: boolean | number | string;
  if (raw === 'true') value = true;
  else if (raw === 'false') value = false;
  else if (/^\d+$/.test(raw)) value = Number(raw);
  else value = raw; // Express also accepts subnet/CIDR strings and 'loopback' etc.

  app.set('trust proxy', value);
  logger.log(`trust proxy enabled (TRUST_PROXY=${raw}) — client IP now derived from X-Forwarded-For.`);
}

async function bootstrap(): Promise<void> {
  logger.log('Bootstrapping module_registry / module_migrations tables...');
  await bootstrapRegistryTables();

  logger.log('Discovering installed (non-core) modules to mount...');
  const discoveredModules = await discoverInstalledModules();

  const app = await NestFactory.create<NestExpressApplication>(
    buildRootModule(discoveredModules.map((m) => m.moduleClass)),
  );
  // `credentials: true` requires an ECHOED origin, never the `cors` package's
  // wildcard default — a browser rejects a credentialed (cookie-carrying)
  // response whose Access-Control-Allow-Origin is `*` (found live during
  // Phase 6's browser verification: the refresh-cookie flow silently failed
  // cross-origin). WEB_ORIGIN is a comma-separated allowlist (e.g. the Vite
  // dev server + the docker-compose `web` nginx origin); with none set,
  // default to the local dev server so `npm run dev` keeps working.
  const webOriginsFromEnv = process.env.WEB_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
  const webOrigins = webOriginsFromEnv.length > 0 ? webOriginsFromEnv : ['http://localhost:5173'];
  app.enableCors({ origin: webOrigins, credentials: true });
  // Refresh tokens travel as an httpOnly cookie (see AuthController) — this
  // is what makes `req.cookies` available to read them back.
  app.use(cookieParser());
  // DTOs (LoginDto, CreateUserDto, ...) rely on class-validator decorators;
  // `whitelist` strips unknown properties, `transform` lets `@Type()`-free
  // primitive coercion (e.g. route params) work as NestJS expects.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  applyTrustProxy(app);

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

  const mountedKeys = discoveredModules.map((m) => m.key);
  logger.log(`${mountedKeys.length} module(s) mounted${mountedKeys.length > 0 ? ` [${mountedKeys.join(', ')}]` : ''}.`);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  logger.log(`Annur Apps API listening on port ${port}`);
}

bootstrap().catch((error) => {
  logger.error('Fatal error during bootstrap', error instanceof Error ? error.stack : error);
  process.exit(1);
});
