import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
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

  describe('D12: zero-grant admin still reaches the Permissions page (the one sanctioned role-name exception)', () => {
    it('an admin with EVERY grant stripped can still list permissions/roles and read/write role grants', async () => {
      const prisma = app!.get(PrismaService);
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });

      // A dedicated, disposable admin account (never the shared fixture) so
      // stripping its grants can't affect any other test in this file.
      const zeroGrantAdmin = await createUserWithRole(app!, 'admin', { label: 'zero-grant-admin' });

      const originalGrants = await prisma.rolePermission.findMany({ where: { roleId: adminRole.id } });
      expect(originalGrants.length).toBeGreaterThan(0); // sanity: admin really does start with grants

      await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });

      try {
        const effective = await prisma.rolePermission.findMany({ where: { roleId: adminRole.id } });
        expect(effective).toHaveLength(0); // confirms the admin role is genuinely zero-grant now

        const listPermissions = await request(app!.getHttpServer())
          .get('/permissions')
          .set('Authorization', `Bearer ${zeroGrantAdmin.token}`);
        expect(listPermissions.status).toBe(200);

        const listRoles = await request(app!.getHttpServer())
          .get('/roles')
          .set('Authorization', `Bearer ${zeroGrantAdmin.token}`);
        expect(listRoles.status).toBe(200);

        const readerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'reader' } });
        const getGrants = await request(app!.getHttpServer())
          .get(`/permissions/roles/${readerRole.id}/grants`)
          .set('Authorization', `Bearer ${zeroGrantAdmin.token}`);
        expect(getGrants.status).toBe(200);

        const setGrants = await request(app!.getHttpServer())
          .put(`/permissions/roles/${readerRole.id}/grants`)
          .set('Authorization', `Bearer ${zeroGrantAdmin.token}`)
          .send({ permissionCodes: ['users.view'] });
        // The zero-grant admin genuinely reaches the grant-write endpoint via
        // PermissionsPageGuard's D12 bypass (@PermissionCheckDelegatedToPermissionsPageGuard
        // stands the global PermissionGuard down here) even though it holds
        // literally zero real grants of its own.
        expect(setGrants.status).toBe(200);

        // A non-admin caller with zero grants, by contrast, is still 403'd —
        // proving this is the admin-role bypass and NOT "no user is ever checked".
        const zeroGrantReader = await createUserWithRole(app!, 'reader', { label: 'zero-grant-reader-control' });
        const controlRes = await request(app!.getHttpServer())
          .get('/permissions')
          .set('Authorization', `Bearer ${zeroGrantReader.token}`);
        expect(controlRes.status).toBe(403);
      } finally {
        // Restore the admin role's real grants so nothing else in this
        // process (later tests, later spec files sharing the worker) is affected.
        await prisma.rolePermission.createMany({
          data: originalGrants.map((g) => ({ roleId: g.roleId, permissionId: g.permissionId, grantedBy: g.grantedBy })),
          skipDuplicates: true,
        });
      }
    });
  });
});
