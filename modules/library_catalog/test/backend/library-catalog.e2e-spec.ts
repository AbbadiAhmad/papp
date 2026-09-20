import { DynamicModule, ForwardReference, INestApplication, Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../../../apps/api/src/app.module';
import { MigrationRunnerService } from '../../../../apps/api/src/core/module-registry/migration-runner.service';
import { ModuleRegistryService } from '../../../../apps/api/src/core/module-registry/module-registry.service';
import { PrismaService } from '../../../../apps/api/src/prisma/prisma.service';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../../../apps/api/test/support/postgres-test-container';
import {
  ALL_ROLE_CODES,
  RoleCode,
  expectPermissionEnforced,
  fixtureForRole,
  roleHasPermission,
  tokenFor,
} from '../../../../test/support/permission-matrix';

/**
 * Tier 2 e2e for the `library_catalog` module (docs/BUILD_PLAN.md Phase 8,
 * D34, docs/TESTING_STRATEGY.md §6) — this is the phase's flagship test: a
 * REAL install of the REAL module (real manifest.json, real migrations,
 * real seeded permissions/default grants — not the module-registry.e2e-spec.ts
 * disposable fixture) mounted into a REALLY-booted app, exercised over real
 * HTTP against a real Testcontainers Postgres.
 *
 * apps/api/test/support/bootstrap-app.ts's `createTestApp()` deliberately
 * boots CORE ONLY (see its own docblock) — modules mount at NestFactory time
 * (D15: no hot-swap), so exercising a real installed module needs its own
 * bootstrap that includes `LibraryCatalogModule` in the root module's
 * `imports` BEFORE `NestFactory.create()` runs. This file's `bootstrap()`
 * below mirrors `createTestApp()`'s core steps and then goes one step
 * further, matching apps/api/src/main.ts's own `buildRootModule()` shape.
 *
 * `public.controller.ts` imports the REAL `PublicThrottlerGuard` from
 * apps/api's BUILT output (`apps/api/dist/...`, never `src/` — see that
 * file's own docblock for why), which means `apps/api` must be built at
 * least once before this module's backend can even be imported — true in
 * every real deployment already. This file guarantees that locally (and in
 * CI) by building it itself, once, if the compiled guard isn't already
 * there, via a lazy `import()` AFTER that build completes (a static
 * top-level import would try to resolve the dist file before this file's own
 * `beforeAll` ever runs).
 */

const here = dirname(fileURLToPath(import.meta.url));
// this file lives at modules/library_catalog/test/backend/ — 4 levels under the repo root.
const REPO_ROOT = join(here, '..', '..', '..', '..');
const CORE_MIGRATIONS_DIR = join(REPO_ROOT, 'apps', 'api', 'src', 'core', 'migrations');
const BOOTSTRAP_MIGRATION_FILENAME = '0000_bootstrap_registry.sql';
const DIST_GUARD_PATH = join(REPO_ROOT, 'apps', 'api', 'dist', 'common', 'guards', 'public-throttler.guard.js');

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

function ensureApiIsBuilt(): void {
  if (existsSync(DIST_GUARD_PATH)) return;
  console.log(
    '[library-catalog.e2e-spec] apps/api/dist is missing (public.controller.ts needs the REAL built ' +
      'PublicThrottlerGuard, per its own docblock) — building apps/api once before this module can be imported...',
  );
  execSync('npm run build --workspace=@papp/api', { cwd: REPO_ROOT, stdio: 'inherit' });
}

type NestImport = Type<unknown> | DynamicModule | ForwardReference | Promise<DynamicModule>;

function buildRootModule(discoveredModuleClasses: unknown[]): Type<unknown> {
  class RootModule {}
  Module({ imports: [AppModule, ...(discoveredModuleClasses as NestImport[])] })(RootModule);
  return RootModule;
}

async function createAppWithLibraryCatalogInstalled(): Promise<INestApplication> {
  await bootstrapRegistryTables();
  ensureApiIsBuilt();

  // Late (dynamic) import — deliberately AFTER ensureApiIsBuilt() so the
  // dist file public.controller.ts needs actually exists by import time.
  //
  // The explicit `.ts` extension is load-bearing: jest.e2e.config.ts (unlike
  // jest.unit.config.ts — see docs/TESTING_STRATEGY.md's "Known Tier 1
  // gotcha #2") does not override the base `moduleFileExtensions: ['js',
  // 'json', 'ts']`, so an EXTENSIONLESS specifier here would resolve to this
  // module's own committed, pre-compiled CommonJS `.js` sibling (per
  // MODULE_SPEC.md §1/D56, every module ships both) instead of the `.ts`
  // source — and that compiled `.js` calls `require('@nestjs/common')`,
  // which fails under this ESM-only-NestJS/Jest-experimental-vm-modules
  // setup ("Must use import to load ES Module", the same class of error
  // jest.base.config.ts's own docblock already documents for htmlparser2).
  // Forcing the `.ts` source directly sidesteps the whole CJS/ESM mismatch:
  // ts-jest compiles it as real ESM, exactly like every other TS import in
  // this test suite.
  const { LibraryCatalogModule } = (await import(
    '../../backend/library-catalog.module.ts'
  )) as { LibraryCatalogModule: Type<unknown> };

  const app = await NestFactory.create(buildRootModule([LibraryCatalogModule]), { logger: false });

  const migrationRunner = app.get(MigrationRunnerService);
  await migrationRunner.applyDirectory(CORE_MIGRATIONS_DIR, 'core');

  const prisma = app.get(PrismaService);
  await prisma.moduleRegistryEntry.upsert({
    where: { key: 'core' },
    update: {},
    create: { key: 'core', version: '0.0.1', status: 'installed', installedAt: new Date() },
  });

  // `resolveModulesDir()` (apps/api/src/core/module-registry/modules-dir.ts)
  // falls back to a `__dirname`-based path when MODULES_DIR is unset — that
  // fallback is CJS-only (real repro, D61): every OTHER spec that installs a
  // module sets MODULES_DIR to a disposable fixture directory (see
  // module-registry.e2e-spec.ts / module-lifecycle.integration-spec.ts), so
  // this was the first place `install()` ever ran with it unset under this
  // ESM-compiled test runtime, throwing `ReferenceError: __dirname is not
  // defined`. This spec deliberately wants the REAL `modules/library_catalog`
  // directory (not a fixture), so it sets MODULES_DIR to that real path
  // explicitly instead — same env var, same resolveModulesDir() codepath
  // every other spec already relies on, just pointed at real content.
  process.env.MODULES_DIR = join(REPO_ROOT, 'modules');

  // The REAL install flow (ModuleRegistryService.install), against the REAL
  // modules/library_catalog/manifest.json + migrations — real permission
  // catalog rows + real default role grants, exactly what
  // POST /modules/install does for an admin in production.
  const moduleRegistry = app.get(ModuleRegistryService);
  await moduleRegistry.install('library_catalog');

  await app.init();
  return app;
}

// A standalone check, deliberately outside the container-dependent
// `describe` below's `beforeAll` (Testcontainers needs a real Docker daemon,
// unavailable in some dev sandboxes — see postgres-test-container.ts's own
// docblock): confirms the dynamic-import machinery itself (ensureApiIsBuilt
// + late `import()` of the real compiled module) resolves to a usable Nest
// module class independent of the database being reachable at all.
//
// (Historical note, resolved — D59/D60: this test used to fail here with
// "Must use import to load ES Module" before jest.e2e.config.ts/
// jest.integration.config.ts carried `moduleFileExtensions: ['ts', 'js',
// 'json']`, and separately with `ReferenceError: __dirname is not defined`
// from `resolveModulesDir()`'s CJS-only fallback before this file started
// setting `MODULES_DIR` explicitly below — see docs/DECISIONS.md D61.)
describe('library_catalog module import wiring (no DB needed)', () => {
  it('the dynamic import of LibraryCatalogModule resolves to a usable Nest module class', async () => {
    ensureApiIsBuilt();
    const imported = (await import('../../backend/library-catalog.module.ts')) as {
      LibraryCatalogModule: Type<unknown>;
    };
    expect(typeof imported.LibraryCatalogModule).toBe('function');
  });
});

describe('library_catalog module (e2e, real install + real HTTP)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;
  let bookId: string;
  let copyId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createAppWithLibraryCatalogInstalled();
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));

    const admin = await fixtureForRole(app!, 'admin');
    const bookRes = await request(app!.getHttpServer())
      .post('/api/library/books')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        title: 'Fixture Book for e2e',
        copy: {
          qrCode: `E2E-INITIAL-${Date.now()}`,
          status: 'available',
        },
      });
    expect(bookRes.status).toBe(201);
    bookId = bookRes.body.id;

    const copyRes = await request(app!.getHttpServer())
      .post(`/api/library/books/${bookId}/copies`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ qrCode: `E2E-QR-${Date.now()}` });
    expect(copyRes.status).toBe(201);
    copyId = copyRes.body.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  it('really installed with the real seeded default grants (per manifest.json defaultRolePermissions)', async () => {
    // admin: all 5; library_assistant: view/create/update; reader: view only; finance: none.
    expect(await roleHasPermission(app!, 'admin', 'library_catalog.books.view')).toBe(true);
    expect(await roleHasPermission(app!, 'admin', 'library_catalog.books.delete')).toBe(true);
    expect(await roleHasPermission(app!, 'library_assistant', 'library_catalog.books.view')).toBe(true);
    expect(await roleHasPermission(app!, 'library_assistant', 'library_catalog.books.create')).toBe(true);
    expect(await roleHasPermission(app!, 'library_assistant', 'library_catalog.books.delete')).toBe(false);
    expect(await roleHasPermission(app!, 'reader', 'library_catalog.books.view')).toBe(true);
    expect(await roleHasPermission(app!, 'reader', 'library_catalog.books.create')).toBe(false);
    expect(await roleHasPermission(app!, 'finance', 'library_catalog.books.view')).toBe(false);
  });

  describe('permission matrix (books)', () => {
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/api/library/books', requiredPermission: 'library_catalog.books.view' });
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/api/library/books/export', requiredPermission: 'library_catalog.books.export' });

    expectPermissionEnforced({
      app: () => app!,
      method: 'post',
      path: '/api/library/books',
      requiredPermission: 'library_catalog.books.create',
      validBody: (role: RoleCode) => ({
        title: `Matrix Book ${role} ${Date.now()}`,
        copy: { qrCode: `E2E-MATRIX-${role}-${Date.now()}`, status: 'available' },
      }),
    });

    it('GET /api/library/books/:id requires library_catalog.books.view', async () => {
      for (const role of ALL_ROLE_CODES) {
        const hasPerm = await roleHasPermission(app!, role, 'library_catalog.books.view');
        const token = await tokenFor(app!, role);
        const res = await request(app!.getHttpServer())
          .get(`/api/library/books/${bookId}`)
          .set('Authorization', `Bearer ${token}`);
        expect({ role, status: res.status }).toEqual({ role, status: hasPerm ? 200 : 403 });
      }
      const anon = await request(app!.getHttpServer()).get(`/api/library/books/${bookId}`);
      expect(anon.status).toBe(401);
    });

    it('PATCH /api/library/books/:id requires library_catalog.books.update and is audited', async () => {
      for (const role of ALL_ROLE_CODES) {
        const hasPerm = await roleHasPermission(app!, role, 'library_catalog.books.update');
        const token = await tokenFor(app!, role);
        const res = await request(app!.getHttpServer())
          .patch(`/api/library/books/${bookId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ author: `Updated by ${role}` });
        expect({ role, status: res.status }).toEqual({ role, status: hasPerm ? 200 : 403 });
      }
      const anon = await request(app!.getHttpServer()).patch(`/api/library/books/${bookId}`).send({ author: 'x' });
      expect(anon.status).toBe(401);

      const prisma = app!.get(PrismaService);
      const row = await prisma.auditLog.findFirst({
        where: { category: 'library_catalog.books', action: 'update', entityId: bookId },
      });
      expect(row).not.toBeNull();
    });

    it('DELETE /api/library/books/:id requires library_catalog.books.delete (admin only by default)', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const disposable = await request(app!.getHttpServer())
        .post('/api/library/books')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          title: `Disposable ${Date.now()}`,
          copy: { qrCode: `E2E-DISPOSABLE-${Date.now()}`, status: 'available' },
        });
      expect(disposable.status).toBe(201);

      const forbidden = await request(app!.getHttpServer())
        .delete(`/api/library/books/${disposable.body.id}`)
        .set('Authorization', `Bearer ${(await fixtureForRole(app!, 'library_assistant')).token}`);
      expect(forbidden.status).toBe(403);

      const anon = await request(app!.getHttpServer()).delete(`/api/library/books/${disposable.body.id}`);
      expect(anon.status).toBe(401);

      // BooksService.remove() rejects a book that still has copies (LIBRARY_CATALOG
      // D7/D19) — the mandatory copy from creation must be removed first.
      const copies = await request(app!.getHttpServer())
        .get(`/api/library/books/${disposable.body.id}/copies`)
        .set('Authorization', `Bearer ${admin.token}`);
      const removeCopy = await request(app!.getHttpServer())
        .delete(`/api/library/books/${disposable.body.id}/copies/${copies.body[0].id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(removeCopy.status).toBe(204);

      const ok = await request(app!.getHttpServer())
        .delete(`/api/library/books/${disposable.body.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(ok.status).toBe(204);
    });
  });

  describe('permission matrix (copies — same books.* codes, no separate copies.* codes per MODULE_SPEC.md)', () => {
    it('GET/POST .../copies and PATCH .../copies/:id follow the SAME books.view/create/update grants', async () => {
      for (const role of ALL_ROLE_CODES) {
        const canView = await roleHasPermission(app!, role, 'library_catalog.books.view');
        const token = await tokenFor(app!, role);
        const list = await request(app!.getHttpServer())
          .get(`/api/library/books/${bookId}/copies`)
          .set('Authorization', `Bearer ${token}`);
        expect({ role, status: list.status }).toEqual({ role, status: canView ? 200 : 403 });

        const canCreate = await roleHasPermission(app!, role, 'library_catalog.books.create');
        const create = await request(app!.getHttpServer())
          .post(`/api/library/books/${bookId}/copies`)
          .set('Authorization', `Bearer ${token}`)
          .send({ qrCode: `MATRIX-${role}-${Date.now()}` });
        expect({ role, status: create.status }).toEqual({ role, status: canCreate ? 201 : 403 });

        const canUpdate = await roleHasPermission(app!, role, 'library_catalog.books.update');
        const update = await request(app!.getHttpServer())
          .patch(`/api/library/books/${bookId}/copies/${copyId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ condition: `checked by ${role}` });
        expect({ role, status: update.status }).toEqual({ role, status: canUpdate ? 200 : 403 });
      }
    });
  });

  describe('THE flagship test: GET /api/library/public/books/:id/availability (D34 public route)', () => {
    it('is reachable with literally NO Authorization header and returns real availability data', async () => {
      const res = await request(app!.getHttpServer()).get(`/api/library/public/books/${bookId}/availability`);
      expect(res.status).toBe(200);
      expect(res.body.bookId).toBe(bookId);
      expect(typeof res.body.totalCopies).toBe('number');
      expect(typeof res.body.availableCopies).toBe('number');
      expect(res.body.totalCopies).toBeGreaterThan(0);
    });

    it('404s a nonexistent book — still with no Authorization header, no stack trace/internal detail leaked', async () => {
      const res = await request(app!.getHttpServer()).get(
        '/api/library/public/books/00000000-0000-0000-0000-000000000000/availability',
      );
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/at\s+\w+\.\w+\s+\(/); // no stack-trace-shaped content
    });

    it('produces a REAL audit_log row with actor_type=\'anonymous\', null actor_user_id, and a captured IP', async () => {
      const prisma = app!.get(PrismaService);
      const before = await prisma.auditLog.count({
        where: { category: 'library_catalog.public', action: 'view_availability', entityId: bookId },
      });

      const res = await request(app!.getHttpServer()).get(`/api/library/public/books/${bookId}/availability`);
      expect(res.status).toBe(200);

      const row = await prisma.auditLog.findFirst({
        where: { category: 'library_catalog.public', action: 'view_availability', entityId: bookId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(row).not.toBeNull();
      expect(row!.actorType).toBe('anonymous');
      expect(row!.actorUserId).toBeNull();
      expect(row!.ipAddress).not.toBeNull();

      const after = await prisma.auditLog.count({
        where: { category: 'library_catalog.public', action: 'view_availability', entityId: bookId },
      });
      expect(after).toBe(before + 1);
    });

    it('PublicThrottlerGuard really 429s a burst of anonymous requests over the per-IP limit', async () => {
      const { SettingsService } = await import('../../../../apps/api/src/core/settings/settings.service');
      const settings = app!.get(SettingsService);
      const limitConfig = await settings.get<{ limit: number; windowSeconds: number }>(
        'security.public_endpoint_rate_limit',
      );

      const attempts = limitConfig.limit + 5;
      const statuses: number[] = [];
      for (let i = 0; i < attempts; i++) {
        const res = await request(app!.getHttpServer()).get(`/api/library/public/books/${bookId}/availability`);
        statuses.push(res.status);
      }

      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(limitConfig.limit);
      expect(statuses.some((s) => s === 429)).toBe(true);
    }, 30_000);

    it('carries no @RequirePermission at all — RBAC is meaningless for an anonymous visitor (MODULE_SPEC.md §7.1)', async () => {
      // Sanity check on the matrix helper's own contract: this route has no
      // permission code to test via expectPermissionEnforced, which is why
      // it gets its own bespoke coverage above instead.
      const admin = await fixtureForRole(app!, 'admin');
      const withAuth = await request(app!.getHttpServer())
        .get(`/api/library/public/books/${bookId}/availability`)
        .set('Authorization', `Bearer ${admin.token}`);
      // A logged-in caller can reach it too (public routes don't reject a session).
      expect([200, 429]).toContain(withAuth.status);
    });
  });
});
