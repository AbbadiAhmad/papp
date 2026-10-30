import { DynamicModule, ForwardReference, INestApplication, Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  const filesDir = mkdtempSync(join(tmpdir(), 'book-files-'));

  beforeAll(async () => {
    process.env.BOOK_FILES_DIR = filesDir;
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
    rmSync(filesDir, { recursive: true, force: true });
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
    // books.download (1.3.0, LIBRARY_CATALOG-D28): staff and readers, never finance
    expect(await roleHasPermission(app!, 'admin', 'library_catalog.books.download')).toBe(true);
    expect(await roleHasPermission(app!, 'library_assistant', 'library_catalog.books.download')).toBe(true);
    expect(await roleHasPermission(app!, 'reader', 'library_catalog.books.download')).toBe(true);
    expect(await roleHasPermission(app!, 'finance', 'library_catalog.books.download')).toBe(false);
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

  describe('cover and book files (LIBRARY_CATALOG-D28)', () => {
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
    const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
    const PDF = Buffer.from('%PDF-1.4\n%fake but recognisable\n');
    const MD = Buffer.from('# Chapter 1\n\nمرحبا\n', 'utf8');
    let id: string;
    const tokenOf = async (role: RoleCode) => `Bearer ${(await fixtureForRole(app!, role)).token}`;
    const upload = async (kind: 'cover' | 'book', bytes: Buffer, name: string, type: string, role: RoleCode = 'admin') =>
      request(app!.getHttpServer())
        .post(`/api/library/books/${id}/files/${kind}`)
        .set('Authorization', await tokenOf(role))
        .attach('file', bytes, { filename: name, contentType: type });
    const folder = () => join(filesDir, id);

    beforeAll(async () => {
      const res = await request(app!.getHttpServer())
        .post('/api/library/books')
        .set('Authorization', await tokenOf('admin'))
        .send({ title: 'The Hobbit: There/and "Back" Again', author: 'J. R. R. Tolkien', copy: { qrCode: `E2E-FILES-${Date.now()}`, status: 'available' } });
      expect(res.status).toBe(201);
      id = res.body.id;
    });

    it('stores files as <books_files>/<book id>/cover.* and book.*, never under the uploaded name, with an info.txt', async () => {
      const cover = await upload('cover', PNG, '../../evil name.png', 'image/png');
      expect(cover.status).toBe(201);
      expect(cover.body.cover).toMatchObject({ ext: 'png', sizeBytes: PNG.length });
      const book = await upload('book', PDF, 'Secret Original Name.pdf', 'application/pdf');
      expect(book.status).toBe(201);
      expect(book.body.book).toMatchObject({ ext: 'pdf' });

      expect(readdirSync(folder()).sort()).toEqual(['book.pdf', 'cover.png', 'info.txt']);
      const info = readFileSync(join(folder(), 'info.txt'), 'utf8');
      expect(info).toContain(`Book ID: ${id}`);
      expect(info).toContain('Title: The Hobbit: There/and "Back" Again');
      expect(info).toContain('Author: J. R. R. Tolkien');
    });

    it('the detail and list responses say what files a book has', async () => {
      const detail = await request(app!.getHttpServer()).get(`/api/library/books/${id}`).set('Authorization', await tokenOf('reader'));
      expect(detail.body.files.cover.ext).toBe('png');
      expect(detail.body.files.book.ext).toBe('pdf');
      const list = await request(app!.getHttpServer()).get('/api/library/books').set('Authorization', await tokenOf('reader'));
      expect(list.body.find((b: { id: string }) => b.id === id).files.book.ext).toBe('pdf');
      expect(list.body.find((b: { id: string }) => b.id !== id).files).toEqual({ cover: null, book: null, images: [] });
    });

    it('serves the cover publicly with safe headers (no login), and never serves the book file that way', async () => {
      const res = await request(app!.getHttpServer()).get(`/api/library/public/books/${id}/cover`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
      expect((await request(app!.getHttpServer()).get(`/api/library/public/books/${id}/book`)).status).toBe(404);
      expect((await request(app!.getHttpServer()).get(`/api/library/public/books/${bookId}/cover`)).status).toBe(404); // a book without a cover
    });

    it('download needs library_catalog.books.download: anonymous 401, finance 403, reader and staff 200; named after the title, as an attachment', async () => {
      const url = `/api/library/books/${id}/files/book`;
      expect((await request(app!.getHttpServer()).get(url)).status).toBe(401);
      expect((await request(app!.getHttpServer()).get(url).set('Authorization', await tokenOf('finance'))).status).toBe(403);
      for (const role of ['reader', 'library_assistant', 'admin'] as const) {
        const res = await request(app!.getHttpServer()).get(url).set('Authorization', await tokenOf(role));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.headers['content-disposition']).toContain('The Hobbit There and Back Again.pdf'); // unsafe characters stripped
        expect(res.headers['content-disposition']).not.toContain('Secret Original Name');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
      }
    });

    it('uploading and removing need books.update: anonymous 401, reader and finance 403', async () => {
      const anon = await request(app!.getHttpServer()).post(`/api/library/books/${id}/files/cover`).attach('file', PNG, 'a.png');
      expect(anon.status).toBe(401);
      for (const role of ['reader', 'finance'] as const) {
        expect((await upload('cover', PNG, 'a.png', 'image/png', role)).status).toBe(403);
        const del = await request(app!.getHttpServer()).delete(`/api/library/books/${id}/files/cover`).set('Authorization', await tokenOf(role));
        expect(del.status).toBe(403);
      }
      expect((await upload('cover', PNG, 'a.png', 'image/png', 'library_assistant')).status).toBe(201);
    });

    it('accepts Markdown books and checks the type from the bytes, not the name or declared type', async () => {
      const md = await upload('book', MD, 'notes.pdf', 'application/pdf'); // lying about the name and type
      expect(md.status).toBe(201);
      expect(md.body.book.ext).toBe('md');
      expect(readdirSync(folder())).toContain('book.md');
      expect(readdirSync(folder())).not.toContain('book.pdf'); // the replaced file was removed
      const dl = await request(app!.getHttpServer()).get(`/api/library/books/${id}/files/book`).set('Authorization', await tokenOf('reader'));
      expect(dl.headers['content-type']).toContain('text/markdown');
      expect(dl.headers['content-disposition']).toContain('.md');
    });

    it('refuses SVG, scripts, executables, a PDF as a cover and a picture as a book, and oversize files', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      expect((await upload('cover', svg, 'x.png', 'image/png')).status).toBe(400);
      expect((await upload('cover', Buffer.from('<html><script>1</script></html>'), 'x.jpg', 'image/jpeg')).status).toBe(400);
      expect((await upload('cover', PDF, 'x.png', 'image/png')).status).toBe(400);
      expect((await upload('book', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]), 'x.pdf', 'application/pdf')).status).toBe(400); // contains NUL: not text
      expect((await upload('book', PNG, 'x.pdf', 'application/pdf')).status).toBe(400);
      expect((await upload('cover', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png', 'image/png')).status).toBe(400);
      expect((await upload('book', Buffer.concat([PDF, Buffer.alloc(31 * 1024 * 1024, 65)]), 'big.pdf', 'application/pdf')).status).toBeGreaterThanOrEqual(400);
      const bad = await request(app!.getHttpServer())
        .post(`/api/library/books/${id}/files/other`)
        .set('Authorization', await tokenOf('admin'))
        .attach('file', PNG, 'a.png');
      expect(bad.status).toBe(400);
      expect((await request(app!.getHttpServer()).post(`/api/library/books/${id}/files/cover`).set('Authorization', await tokenOf('admin'))).status).toBe(400);
      expect(readdirSync(folder()).sort()).toEqual(['book.md', 'cover.png', 'info.txt']); // nothing leaked onto disk
    }, 60_000);

    it('replacing a cover with another format removes the old file', async () => {
      expect((await upload('cover', JPG, 'c.jpeg', 'image/jpeg')).status).toBe(201);
      expect(readdirSync(folder())).toContain('cover.jpg');
      expect(readdirSync(folder())).not.toContain('cover.png');
      const res = await request(app!.getHttpServer()).get(`/api/library/public/books/${id}/cover`);
      expect(res.headers['content-type']).toContain('image/jpeg');
    });

    it('editing the book rewrites info.txt, and uploads are audited without the file bytes', async () => {
      const patch = await request(app!.getHttpServer()).patch(`/api/library/books/${id}`).set('Authorization', await tokenOf('admin')).send({ title: 'Renamed Hobbit' });
      expect(patch.status).toBe(200);
      expect(readFileSync(join(folder(), 'info.txt'), 'utf8')).toContain('Title: Renamed Hobbit');
      const prisma = app!.get(PrismaService);
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM audit_log WHERE entity_type = 'LibraryCatalogBookFile' AND action IN ('upload_file','download_file')`);
      expect(Number(rows[0].n)).toBeGreaterThan(0);
      const leak = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM audit_log WHERE entity_type = 'LibraryCatalogBookFile' AND (new_value::text LIKE '%PNG%' OR new_value::text LIKE '%PDF-1.4%')`);
      expect(Number(leak[0].n)).toBe(0);
    });

    it('the books export has the book id as its first column', async () => {
      const res = await request(app!.getHttpServer())
        .get('/api/library/books/export')
        .set('Authorization', await tokenOf('admin'))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as Buffer);
      const sheet = wb.worksheets[0];
      expect(sheet.getRow(1).getCell(1).value).toBe('id');
      const ids: string[] = [];
      sheet.eachRow((row, n) => n > 1 && ids.push(String(row.getCell(1).value)));
      expect(ids).toContain(id);
    });

    it('the books import requires library_catalog.books.import (preview and commit)', async () => {
      for (const path of ['/api/library/books/import/preview', '/api/library/books/import']) {
        for (const role of ALL_ROLE_CODES) {
          const hasPerm = await roleHasPermission(app!, role, 'library_catalog.books.import');
          const res = await request(app!.getHttpServer()).post(path).set('Authorization', `Bearer ${await tokenFor(app!, role)}`);
          // Allowed roles pass the guard and fail on the missing file (400); the others never get that far.
          expect({ role, path, status: res.status }).toEqual({ role, path, status: hasPerm ? 400 : 403 });
        }
        expect((await request(app!.getHttpServer()).post(path)).status).toBe(401);
      }
    });

    it('a file produced by the export previews cleanly, imports back as "unchanged", and a commit applies only what was chosen', async () => {
      const exported = await request(app!.getHttpServer())
        .get('/api/library/books/export')
        .set('Authorization', await tokenOf('admin'))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      const preview = await request(app!.getHttpServer())
        .post('/api/library/books/import/preview')
        .set('Authorization', await tokenOf('admin'))
        .attach('file', exported.body as Buffer, 'books.xlsx');
      expect(preview.status).toBe(200);
      expect(preview.body.errorCount).toBe(0);
      const plan = preview.body.books.find((b: { bookId: string }) => b.bookId === id);
      expect(plan.action).toBe('unchanged');
      expect(plan.copies.every((c: { action: string }) => c.action === 'unchanged')).toBe(true);

      // Edit the title in the file, then commit with the change declined: nothing is written.
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(exported.body as Buffer);
      const sheet = wb.worksheets[0];
      let edited = false;
      sheet.eachRow((row, n) => {
        if (n > 1 && String(row.getCell(1).value) === id && !edited) {
          row.getCell(2).value = 'Edited through import';
          edited = true;
        }
      });
      const editedBuffer = Buffer.from(await wb.xlsx.writeBuffer());
      const editedPreview = await request(app!.getHttpServer())
        .post('/api/library/books/import/preview')
        .set('Authorization', await tokenOf('admin'))
        .attach('file', editedBuffer, 'books.xlsx');
      const editedPlan = editedPreview.body.books.find((b: { bookId: string }) => b.bookId === id);
      expect(editedPlan.action).toBe('update');
      expect(editedPlan.fields.find((f: { field: string }) => f.field === 'title')).toMatchObject({ incoming: 'Edited through import', differs: true });

      const declined = await commitWith(false);
      expect(declined.status).toBe(200);
      expect(declined.body.result.booksUpdated).toBe(0);
      const applied = await commitWith(true);
      expect(applied.status).toBe(200);
      expect(applied.body.result.booksUpdated).toBe(1);
      const after = await request(app!.getHttpServer()).get(`/api/library/books/${id}`).set('Authorization', await tokenOf('admin'));
      expect(after.body.title).toBe('Edited through import (final)');

      async function commitWith(apply: boolean) {
        return request(app!.getHttpServer())
          .post('/api/library/books/import')
          .set('Authorization', await tokenOf('admin'))
          .field('decisions', JSON.stringify({ books: { [editedPlan.key]: { apply, fields: { title: 'Edited through import (final)' } } } }))
          .attach('file', editedBuffer, 'books.xlsx');
      }
    });

    it('removing one file keeps the other; removing the last file removes the folder; a missing file is 404', async () => {
      const del = (kind: string, role: RoleCode = 'admin') =>
        request(app!.getHttpServer()).delete(`/api/library/books/${id}/files/${kind}`);
      expect((await del('cover').set('Authorization', await tokenOf('admin'))).status).toBe(204);
      expect(readdirSync(folder()).sort()).toEqual(['book.md', 'info.txt']);
      expect((await del('cover').set('Authorization', await tokenOf('admin'))).status).toBe(404);
      expect((await request(app!.getHttpServer()).get(`/api/library/public/books/${id}/cover`)).status).toBe(404);
      expect((await del('book').set('Authorization', await tokenOf('admin'))).status).toBe(204);
      expect(existsSync(folder())).toBe(false);
    });

    it('deleting a book deletes its folder', async () => {
      expect((await upload('cover', PNG, 'a.png', 'image/png')).status).toBe(201);
      expect(existsSync(folder())).toBe(true);
      // a book with registered copies cannot be deleted, so remove them first
      const copies = await request(app!.getHttpServer()).get(`/api/library/books/${id}/copies`).set('Authorization', await tokenOf('admin'));
      for (const copy of copies.body as Array<{ id: string }>) {
        const gone = await request(app!.getHttpServer()).delete(`/api/library/books/${id}/copies/${copy.id}`).set('Authorization', await tokenOf('admin'));
        expect(gone.status).toBe(204);
      }
      const del = await request(app!.getHttpServer()).delete(`/api/library/books/${id}`).set('Authorization', await tokenOf('admin'));
      expect(del.status).toBe(204);
      expect(existsSync(folder())).toBe(false);
    });
  });

  // docs/TESTING_STRATEGY.md §2/§3/§6/§7 for the file endpoints (1.3.0).
  describe('cover and book files: permission matrix, audit, lifecycle (LIBRARY_CATALOG-D28)', () => {
    let fid: string;
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 3)]);
    const adminAuth = async () => `Bearer ${(await fixtureForRole(app!, 'admin')).token}`;

    beforeAll(async () => {
      const created = await request(app!.getHttpServer())
        .post('/api/library/books')
        .set('Authorization', await adminAuth())
        .send({ title: 'Matrix book', copy: { qrCode: `E2E-FM-${Date.now()}`, status: 'available' } });
      fid = created.body.id as string;
      for (const [kind, bytes, name] of [['book', Buffer.from('# text book\n'), 'b.md'], ['cover', PNG, 'c.png']] as const) {
        const res = await request(app!.getHttpServer()).post(`/api/library/books/${fid}/files/${kind}`).set('Authorization', await adminAuth()).attach('file', bytes, name);
        expect(res.status).toBe(201);
      }
    });

    expectPermissionEnforced({
      app: () => app!,
      method: 'get',
      path: () => `/api/library/books/${fid}/files/book`,
      label: '/api/library/books/:id/files/book',
      requiredPermission: 'library_catalog.books.download',
    });
    // library_assistant is left out of the DELETE sweep: the first role to succeed removes the file, so a second
    // permitted role would (correctly) get 404. Its permission is the same code and is covered by the upload tests.
    expectPermissionEnforced({
      app: () => app!,
      method: 'delete',
      path: () => `/api/library/books/${fid}/files/cover`,
      label: '/api/library/books/:id/files/cover',
      requiredPermission: 'library_catalog.books.update',
      roles: ['admin', 'finance', 'reader'],
    });

    it('records upload, download and delete in the audit trail without the file contents (§3)', async () => {
      const rows = await app!.get(PrismaService).$queryRawUnsafe<Array<{ action: string; new_value: unknown }>>(
        `SELECT action, new_value FROM audit_log WHERE entity_type = 'LibraryCatalogBookFile'`,
      );
      expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['upload_file', 'download_file', 'delete_file']));
      expect(JSON.stringify(rows.map((r) => r.new_value))).not.toMatch(/PNG|text book/);
    });

    it('the public cover route is reachable without credentials but is not a way to the book file (§6)', async () => {
      expect((await request(app!.getHttpServer()).get(`/api/library/public/books/${fid}/cover`)).status).toBe(404); // deleted above
      expect((await request(app!.getHttpServer()).get(`/api/library/books/${fid}/files/book`)).status).toBe(401);
    });

    it('a fresh install recorded every migration file (008 included) exactly once (§7)', async () => {
      const files = readdirSync(join(dirname(fileURLToPath(import.meta.url)), '../../migrations')).filter((f) => f.endsWith('.sql')).sort();
      const rows = await app!.get(PrismaService).$queryRawUnsafe<Array<{ filename: string }>>(`SELECT filename FROM module_migrations WHERE module_key = 'library_catalog' ORDER BY filename`);
      expect(rows.map((r) => r.filename)).toEqual(files);
    });
  });
});
