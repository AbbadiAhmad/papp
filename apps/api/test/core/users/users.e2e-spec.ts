import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import {
  ALL_ROLE_CODES,
  createUserWithRole,
  expectPermissionEnforced,
  fixtureForRole,
} from '../../../../../test/support/permission-matrix';

/**
 * Tier 2 e2e: Users CRUD (permission matrix, per docs/TESTING_STRATEGY.md
 * §2) + the Excel import/export surface (excel-import.controller.ts).
 */
describe('Users (e2e)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    // Warm the 4 role fixtures once up front (admin/library_assistant/finance/reader).
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  describe('GET /users/me', () => {
    it('is reachable by every role with no permission grant needed (self-scoped)', async () => {
      for (const role of ALL_ROLE_CODES) {
        const fixture = await fixtureForRole(app!, role);
        const res = await request(app!.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${fixture.token}`);
        expect(res.status).toBe(200);
        expect(res.body.email).toBe(fixture.email);
        expect(res.body).not.toHaveProperty('passwordHash');
      }
    });

    it('401s with no token', async () => {
      const res = await request(app!.getHttpServer()).get('/users/me');
      expect(res.status).toBe(401);
    });
  });

  describe('permission matrix', () => {
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/users', requiredPermission: 'users.view' });

    it('GET /users/:id requires users.view', async () => {
      const target = await fixtureForRole(app!, 'reader');
      await expectPermissionEnforcedAsync({
        app: app!,
        method: 'get',
        path: `/users/${target.userId}`,
        requiredPermission: 'users.view',
      });
    });

    it('POST /users requires users.create', async () => {
      await expectPermissionEnforcedAsync({
        app: app!,
        method: 'post',
        path: '/users',
        requiredPermission: 'users.create',
        validBody: (role) => ({
          email: `e2e-matrix-create-${role}-${Date.now()}@papp.test`,
          name: `Matrix Create ${role}`,
          password: 'MatrixCreate123',
        }),
      });
    });

    it('PATCH /users/:id requires users.update', async () => {
      const target = await createUserWithRole(app!, 'reader', { label: 'patch-target' });
      await expectPermissionEnforcedAsync({
        app: app!,
        method: 'patch',
        path: `/users/${target.userId}`,
        requiredPermission: 'users.update',
        validBody: { department: 'Updated Dept' },
      });
    });

    it('DELETE /users/:id requires users.delete', async () => {
      // Only admin holds users.delete by default (0004 cross-join), so a
      // single disposable target is enough — no other role's loop iteration
      // reaches the service (PermissionGuard 403s them before that).
      const target = await createUserWithRole(app!, 'reader', { label: 'delete-target' });
      await expectPermissionEnforcedAsync({
        app: app!,
        method: 'delete',
        path: `/users/${target.userId}`,
        requiredPermission: 'users.delete',
        expectedSuccessStatus: 204,
      });
    });
  });

  describe('a permitted PATCH really persists and is audited', () => {
    it('updates the row and writes an audit row with the diff', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const target = await createUserWithRole(app!, 'reader', { label: 'audit-patch' });

      const res = await request(app!.getHttpServer())
        .patch(`/users/${target.userId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ department: 'Circulation' });
      expect(res.status).toBe(200);
      expect(res.body.department).toBe('Circulation');

      const prisma = app!.get(PrismaService);
      const row = await prisma.auditLog.findFirst({
        where: { category: 'core.users', action: 'update', entityId: target.userId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(row).not.toBeNull();
      expect(row!.actorType).toBe('user');
      expect(row!.actorUserId).toBe(admin.userId);
      // passwordHash must NEVER appear un-redacted in either side of the diff.
      expect(JSON.stringify(row!.oldValue)).not.toContain(target.password);
      expect((row!.newValue as Record<string, unknown>)?.passwordHash).toBe('[redacted]');
    });
  });

  describe('Excel import/export (users.import / users.export)', () => {
    async function buildWorkbook(rows: Array<{ name: string; email: string; role: string; department?: string }>) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Users');
      sheet.addRow(['name', 'email', 'role', 'department']);
      for (const r of rows) sheet.addRow([r.name, r.email, r.role, r.department ?? '']);
      return workbook.xlsx.writeBuffer();
    }

    it('users.import gates preview+commit; an authorized role can really import a new user end to end', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const reader = await fixtureForRole(app!, 'reader');
      const email = `e2e-import-${Date.now()}@papp.test`;
      const buffer = await buildWorkbook([{ name: 'Imported User', email, role: 'reader' }]);

      const forbidden = await request(app!.getHttpServer())
        .post('/users/import/preview')
        .set('Authorization', `Bearer ${reader.token}`)
        .attach('file', Buffer.from(buffer), 'users.xlsx');
      expect(forbidden.status).toBe(403);

      const preview = await request(app!.getHttpServer())
        .post('/users/import/preview')
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', Buffer.from(buffer), 'users.xlsx');
      expect(preview.status).toBe(200);
      expect(preview.body.allValid).toBe(true);

      const commit = await request(app!.getHttpServer())
        .post('/users/import')
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', Buffer.from(buffer), 'users.xlsx');
      expect(commit.status).toBe(200);
      expect(commit.body.allValid).toBe(true);

      const prisma = app!.get(PrismaService);
      const created = await prisma.user.findUnique({ where: { email } });
      expect(created).not.toBeNull();

      const auditRow = await prisma.auditLog.findFirst({
        where: { category: 'core.users', action: 'import' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(auditRow).not.toBeNull();
    });

    it('users.export requires the permission and returns a real .xlsx buffer for an authorized role', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const reader = await fixtureForRole(app!, 'reader');

      const forbidden = await request(app!.getHttpServer())
        .get('/users/export')
        .set('Authorization', `Bearer ${reader.token}`);
      expect(forbidden.status).toBe(403);

      const anon = await request(app!.getHttpServer()).get('/users/export');
      expect(anon.status).toBe(401);

      const ok = await request(app!.getHttpServer()).get('/users/export').set('Authorization', `Bearer ${admin.token}`);
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toContain('spreadsheetml');
      expect(ok.body.length).toBeGreaterThan(0);
    });
  });
});

/**
 * A thin async wrapper so a matrix check can run INSIDE an already-running
 * `it(...)` (e.g. after creating a disposable target row) instead of
 * `expectPermissionEnforced`'s own `it(...)`-registering form, which must be
 * called at `describe`-body time. Re-implements nothing: it drives the exact
 * same real app/tokens/roleHasPermission helpers, just inline.
 */
async function expectPermissionEnforcedAsync(opts: {
  app: INestApplication;
  method: 'get' | 'post' | 'patch' | 'delete' | 'put';
  path: string;
  requiredPermission: string;
  validBody?: object | ((role: (typeof ALL_ROLE_CODES)[number]) => object | undefined);
  expectedSuccessStatus?: number;
}): Promise<void> {
  const { roleHasPermission, tokenFor } = await import('../../../../../test/support/permission-matrix');
  const defaultStatus = { get: 200, post: 201, patch: 200, put: 200, delete: 204 }[opts.method];
  const successStatus = opts.expectedSuccessStatus ?? defaultStatus;

  for (const role of ALL_ROLE_CODES) {
    const [hasPerm, token] = await Promise.all([
      roleHasPermission(opts.app, role, opts.requiredPermission),
      tokenFor(opts.app, role),
    ]);
    const body = typeof opts.validBody === 'function' ? opts.validBody(role) : opts.validBody;
    const agent = request(opts.app.getHttpServer());
    let req = agent[opts.method](opts.path).set('Authorization', `Bearer ${token}`);
    if (body !== undefined) req = req.send(body);
    const res = await req;
    if (hasPerm) {
      expect({ role, status: res.status }).toEqual({ role, status: successStatus });
    } else {
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
    }
  }

  const anon = await request(opts.app.getHttpServer())[opts.method](opts.path);
  expect(anon.status).toBe(401);
}
