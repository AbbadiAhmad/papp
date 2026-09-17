import { DynamicModule, ForwardReference, INestApplication, Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MigrationRunnerService } from '../../../src/core/module-registry/migration-runner.service';
import { ModuleRegistryService } from '../../../src/core/module-registry/module-registry.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { ALL_ROLE_CODES, expectPermissionEnforced, fixtureForRole, roleHasPermission, tokenFor } from '../../../../../test/support/permission-matrix';

/**
 * Tier 2 e2e for `library_circulation` (D44) — same real-install pattern as
 * `library-catalog.e2e-spec.ts` (see that file's own extensive docblock for
 * WHY each step below exists: the dist-build-then-late-.ts-import dance for
 * `PublicThrottlerGuard`/CJS-ESM, the `MODULES_DIR` real-path requirement,
 * etc). This module additionally `dependsOn: ["library_catalog"]`, so BOTH
 * modules are installed here, in that order, mirroring exactly what an
 * admin does through the real Modules screen.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..', '..', '..');
const CORE_MIGRATIONS_DIR = join(here, '..', '..', '..', 'src', 'core', 'migrations');
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
  execSync('npm run build --workspace=@papp/api', { cwd: REPO_ROOT, stdio: 'inherit' });
}

type NestImport = Type<unknown> | DynamicModule | ForwardReference | Promise<DynamicModule>;

function buildRootModule(discoveredModuleClasses: unknown[]): Type<unknown> {
  class RootModule {}
  Module({ imports: [AppModule, ...(discoveredModuleClasses as NestImport[])] })(RootModule);
  return RootModule;
}

async function createAppWithLibraryCirculationInstalled(): Promise<INestApplication> {
  await bootstrapRegistryTables();
  ensureApiIsBuilt();

  const { LibraryCatalogModule } = (await import('../../../../../modules/library_catalog/backend/library-catalog.module.ts')) as {
    LibraryCatalogModule: Type<unknown>;
  };
  const { LibraryCirculationModule } = (await import(
    '../../../../../modules/library_circulation/backend/library-circulation.module.ts'
  )) as { LibraryCirculationModule: Type<unknown> };

  const app = await NestFactory.create(buildRootModule([LibraryCatalogModule, LibraryCirculationModule]), { logger: false });

  const migrationRunner = app.get(MigrationRunnerService);
  await migrationRunner.applyDirectory(CORE_MIGRATIONS_DIR, 'core');

  const prisma = app.get(PrismaService);
  await prisma.moduleRegistryEntry.upsert({
    where: { key: 'core' },
    update: {},
    create: { key: 'core', version: '0.0.1', status: 'installed', installedAt: new Date() },
  });

  process.env.MODULES_DIR = join(REPO_ROOT, 'modules');

  const moduleRegistry = app.get(ModuleRegistryService);
  await moduleRegistry.install('library_catalog'); // dependency first (dependsOn validation)
  await moduleRegistry.install('library_circulation');

  await app.init();
  return app;
}

describe('library_circulation module (e2e, real install + real HTTP)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;
  let copyId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createAppWithLibraryCirculationInstalled();
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));

    const admin = await fixtureForRole(app!, 'admin');
    const bookRes = await request(app!.getHttpServer())
      .post('/api/library/books')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ title: 'Fixture Book for circulation e2e' });
    expect(bookRes.status).toBe(201);

    const copyRes = await request(app!.getHttpServer())
      .post(`/api/library/books/${bookRes.body.id}/copies`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ qrCode: `E2E-CIRC-QR-${Date.now()}` });
    expect(copyRes.status).toBe(201);
    copyId = copyRes.body.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  it('really installed with the real seeded default grants (per manifest.json defaultRolePermissions)', async () => {
    expect(await roleHasPermission(app!, 'admin', 'library_circulation.borrow')).toBe(true);
    expect(await roleHasPermission(app!, 'library_assistant', 'library_circulation.borrow')).toBe(true);
    expect(await roleHasPermission(app!, 'library_assistant', 'library_circulation.fines.record')).toBe(false); // §1: optionally granted, not default
    expect(await roleHasPermission(app!, 'finance', 'library_circulation.finance.record_payment')).toBe(true);
    expect(await roleHasPermission(app!, 'finance', 'library_circulation.borrow')).toBe(false);
    expect(await roleHasPermission(app!, 'reader', 'library_circulation.students.view')).toBe(false);
  });

  describe('permission matrix', () => {
    expectPermissionEnforced({
      app: () => app!,
      method: 'get',
      path: '/api/library-circulation/students',
      requiredPermission: 'library_circulation.students.view',
    });
    expectPermissionEnforced({
      app: () => app!,
      method: 'get',
      path: '/api/library-circulation/fines',
      requiredPermission: 'library_circulation.fines.view',
    });
  });

  describe('the full borrow -> late return -> auto-fine -> payment flow (§39 acceptance scenario, scoped)', () => {
    let studentId: string;
    let borrowingId: string;
    let fineId: string;

    it('creates a student (real login account + library profile) as an admin', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const res = await request(app!.getHttpServer())
        .post('/api/library-circulation/students')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Fixture Student', email: `student-${Date.now()}@school.test`, code: `STU-E2E-${Date.now()}` });
      expect(res.status).toBe(201);
      expect(res.body.temporaryPassword).toBeTruthy();
      studentId = res.body.id;

      const row = await app!
        .get(PrismaService)
        .auditLog.findFirst({ where: { category: 'library_circulation.students', action: 'create', entityId: studentId } });
      expect(row).not.toBeNull(); // audited (§21)
    });

    it('borrows the fixture copy for that student', async () => {
      const assistant = await fixtureForRole(app!, 'library_assistant');
      const res = await request(app!.getHttpServer())
        .post('/api/library-circulation/borrow')
        .set('Authorization', `Bearer ${assistant.token}`)
        .send({ studentId, bookCopyId: copyId });
      expect(res.status).toBe(201);
      borrowingId = res.body.id;
    });

    it('rejects double-borrowing the same (now-borrowed) copy (§22)', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const otherStudent = await request(app!.getHttpServer())
        .post('/api/library-circulation/students')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Other Student', email: `other-${Date.now()}@school.test`, code: `STU-E2E-OTHER-${Date.now()}` });

      const res = await request(app!.getHttpServer())
        .post('/api/library-circulation/borrow')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ studentId: otherStudent.body.id, bookCopyId: copyId });
      expect(res.status).toBe(409);
    });

    it('returns the book late (due date forced into the past) and auto-creates a late fine', async () => {
      const prisma = app!.get(PrismaService);
      await prisma.libraryBorrowing.update({
        where: { id: borrowingId },
        data: { dueAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
      });

      const assistant = await fixtureForRole(app!, 'library_assistant');
      const res = await request(app!.getHttpServer())
        .post('/api/library-circulation/return')
        .set('Authorization', `Bearer ${assistant.token}`)
        .send({ borrowingId });
      expect(res.status).toBe(201);
      expect(res.body.daysLate).toBeGreaterThanOrEqual(3);
      expect(res.body.lateFine).not.toBeNull();
      fineId = res.body.lateFine.id;

      const fines = await request(app!.getHttpServer())
        .get(`/api/library-circulation/fines?studentId=${studentId}`)
        .set('Authorization', `Bearer ${assistant.token}`);
      expect(fines.body.some((f: { id: string }) => f.id === fineId)).toBe(true);
    });

    it('records a full payment against the fine and issues a receipt', async () => {
      const finance = await fixtureForRole(app!, 'finance');
      const fineBefore = await request(app!.getHttpServer())
        .get(`/api/library-circulation/fines/${fineId}`)
        .set('Authorization', `Bearer ${finance.token}`);
      const fullAmount = Number(fineBefore.body.amount);

      const res = await request(app!.getHttpServer())
        .post(`/api/library-circulation/fines/${fineId}/payments`)
        .set('Authorization', `Bearer ${finance.token}`)
        .send({ amount: fullAmount });
      expect(res.status).toBe(201);
      expect(res.body.fine.status).toBe('paid');
      expect(res.body.receipt.receiptNumber).toMatch(/^RC-/);

      const overpay = await request(app!.getHttpServer())
        .post(`/api/library-circulation/fines/${fineId}/payments`)
        .set('Authorization', `Bearer ${finance.token}`)
        .send({ amount: 1 });
      expect(overpay.status).toBe(409); // already paid — §22
    });

    it('§22: refuses to delete the student now that they have borrowing history', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const res = await request(app!.getHttpServer())
        .delete(`/api/library-circulation/students/${studentId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(409);
    });
  });

  describe('§14/§22 duplicate-fine prevention', () => {
    it('requires confirmDuplicate to record a second identical open fine', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const student = await request(app!.getHttpServer())
        .post('/api/library-circulation/students')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Dup Fine Student', email: `dupfine-${Date.now()}@school.test`, code: `STU-DUP-${Date.now()}` });
      const fineTypes = await request(app!.getHttpServer())
        .get('/api/library-circulation/fine-types')
        .set('Authorization', `Bearer ${admin.token}`);
      const otherType = fineTypes.body.find((t: { code: string }) => t.code === 'FINE-OTHER');

      const first = await request(app!.getHttpServer())
        .post('/api/library-circulation/fines')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ studentId: student.body.id, fineTypeId: otherType.id, amount: 5 });
      expect(first.status).toBe(201);

      const duplicate = await request(app!.getHttpServer())
        .post('/api/library-circulation/fines')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ studentId: student.body.id, fineTypeId: otherType.id, amount: 5 });
      expect(duplicate.status).toBe(409);

      const confirmed = await request(app!.getHttpServer())
        .post('/api/library-circulation/fines')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ studentId: student.body.id, fineTypeId: otherType.id, amount: 5, confirmDuplicate: true });
      expect(confirmed.status).toBe(201);
    });
  });
});
