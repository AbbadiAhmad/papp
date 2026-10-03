import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { ALL_ROLE_CODES, expectPermissionEnforced, fixtureForRole } from '../../../../../test/support/permission-matrix';

describe('Permissions (e2e)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  describe('permission matrix', () => {
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/permissions', requiredPermission: 'permissions.view' });

    it('GET /permissions/roles/:roleId/grants requires permissions.view', async () => {
      const prisma = app!.get(PrismaService);
      const readerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'reader' } });
      const admin = await fixtureForRole(app!, 'admin');
      const finance = await fixtureForRole(app!, 'finance');

      const forbidden = await request(app!.getHttpServer())
        .get(`/permissions/roles/${readerRole.id}/grants`)
        .set('Authorization', `Bearer ${finance.token}`);
      expect(forbidden.status).toBe(403);

      const ok = await request(app!.getHttpServer())
        .get(`/permissions/roles/${readerRole.id}/grants`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(ok.status).toBe(200);
      expect(Array.isArray(ok.body)).toBe(true);

      const anon = await request(app!.getHttpServer()).get(`/permissions/roles/${readerRole.id}/grants`);
      expect(anon.status).toBe(401);
    });

    it('PUT /permissions/roles/:roleId/grants requires permissions.grant and is audited with the full grant diff', async () => {
      const prisma = app!.get(PrismaService);
      const admin = await fixtureForRole(app!, 'admin');
      const financeRole = await prisma.role.findUniqueOrThrow({ where: { code: 'finance' } });

      const forbidden = await request(app!.getHttpServer())
        .put(`/permissions/roles/${financeRole.id}/grants`)
        .set('Authorization', `Bearer ${(await fixtureForRole(app!, 'library_assistant')).token}`)
        .send({ permissionCodes: ['users.view'] });
      expect(forbidden.status).toBe(403);

      const grant = await request(app!.getHttpServer())
        .put(`/permissions/roles/${financeRole.id}/grants`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ permissionCodes: ['audit.view'] });
      expect(grant.status).toBe(200);
      expect(grant.body).toEqual(['audit.view']);

      const row = await prisma.auditLog.findFirst({
        where: { category: 'core.permissions', action: 'permission_grant', entityId: financeRole.id },
        orderBy: { occurredAt: 'desc' },
      });
      expect(row).not.toBeNull();
      // finance holds notifications.view (0006_create_notifications.sql) plus the four
      // D83 self-scoped permission codes added by 0010 — the real "before"
      // state, not an empty set; this PUT is a full replace, which is why
      // all of them disappear from newValue below.
      expect((row!.oldValue as { permissionCodes: string[] }).permissionCodes).toEqual(
        expect.arrayContaining(['notifications.view', 'permissions.view_my', 'sessions.view_my', 'users.preferences.update_my', 'users.preferences.view_my']),
      );
      expect((row!.newValue as { permissionCodes: string[] }).permissionCodes).toEqual(['audit.view']);

      // Revoke again so it doesn't leak into other tests in this file.
      await request(app!.getHttpServer())
        .put(`/permissions/roles/${financeRole.id}/grants`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ permissionCodes: [] });
    });
  });

  describe('admin role grant protection (structural replacement for the old D12 bypass)', () => {
    it('rejects revoking permissions.view/permissions.grant from the admin role, but allows revoking any other permission', async () => {
      const prisma = app!.get(PrismaService);
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
      const admin = await fixtureForRole(app!, 'admin');

      const originalGrants = await prisma.rolePermission.findMany({
        where: { roleId: adminRole.id },
        include: { permission: true },
      });
      const originalCodes = originalGrants.map((g) => g.permission.code);
      expect(originalCodes).toEqual(expect.arrayContaining(['permissions.view', 'permissions.grant']));

      try {
        // Attempting to submit admin's full grant set MINUS permissions.view
        // is rejected outright — the write never happens.
        const withoutView = await request(app!.getHttpServer())
          .put(`/permissions/roles/${adminRole.id}/grants`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ permissionCodes: originalCodes.filter((c) => c !== 'permissions.view') });
        expect(withoutView.status).toBe(403);

        const withoutGrant = await request(app!.getHttpServer())
          .put(`/permissions/roles/${adminRole.id}/grants`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ permissionCodes: originalCodes.filter((c) => c !== 'permissions.grant') });
        expect(withoutGrant.status).toBe(403);

        const stillIntact = await prisma.rolePermission.findMany({ where: { roleId: adminRole.id } });
        expect(stillIntact).toHaveLength(originalGrants.length); // confirms neither rejected write partially applied

        // Revoking some OTHER permission from admin (keeping both protected
        // codes) still succeeds — this is not a blanket "admin is immutable"
        // rule, only the two protected codes are guarded.
        const dropOther = originalCodes.filter((c) => c !== 'audit.view');
        const otherOk = await request(app!.getHttpServer())
          .put(`/permissions/roles/${adminRole.id}/grants`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ permissionCodes: dropOther });
        expect(otherOk.status).toBe(200);
        expect(otherOk.body).toEqual(expect.arrayContaining(['permissions.view', 'permissions.grant']));
        expect(otherOk.body).not.toEqual(expect.arrayContaining(['audit.view']));
      } finally {
        // Restore the admin role's real grants so nothing else in this
        // process (later tests, later spec files sharing the worker) is affected.
        await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });
        await prisma.rolePermission.createMany({
          data: originalGrants.map((g) => ({ roleId: g.roleId, permissionId: g.permissionId, grantedBy: g.grantedBy })),
          skipDuplicates: true,
        });
      }
    });

    it('still allows revoking permissions.view/permissions.grant from a NON-admin role', async () => {
      const prisma = app!.get(PrismaService);
      const admin = await fixtureForRole(app!, 'admin');
      const financeRole = await prisma.role.findUniqueOrThrow({ where: { code: 'finance' } });

      const res = await request(app!.getHttpServer())
        .put(`/permissions/roles/${financeRole.id}/grants`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ permissionCodes: [] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
