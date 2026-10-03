import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { ALL_ROLE_CODES, createUserWithRole, expectPermissionEnforced, fixtureForRole } from '../../../../../test/support/permission-matrix';

describe('Roles (e2e)', () => {
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
    // roles.view: admin only by default (0004) — plain permission check,
    // same as every other endpoint.
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/roles', requiredPermission: 'roles.view' });

    expectPermissionEnforced({
      app: () => app!,
      method: 'post',
      path: '/roles',
      requiredPermission: 'roles.create',
      validBody: (role) => ({ code: `e2e_matrix_${role}_${Date.now()}`, nameI18nKey: `core.roles.e2e_${role}` }),
    });
  });

  it('GET /roles/user/:userId requires roles.view', async () => {
    const target = await fixtureForRole(app!, 'reader');
    const admin = await fixtureForRole(app!, 'admin');
    const forbidden = await request(app!.getHttpServer())
      .get(`/roles/user/${target.userId}`)
      .set('Authorization', `Bearer ${(await fixtureForRole(app!, 'finance')).token}`);
    expect(forbidden.status).toBe(403);

    const ok = await request(app!.getHttpServer())
      .get(`/roles/user/${target.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.map((r: { code: string }) => r.code)).toContain('reader');
  });

  it('PATCH/DELETE /roles/:id require roles.update/roles.delete, and system roles cannot be deleted', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const finance = await fixtureForRole(app!, 'finance');
    const prisma = app!.get(PrismaService);

    const created = await request(app!.getHttpServer())
      .post('/roles')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ code: `e2e_custom_${Date.now()}`, nameI18nKey: 'core.roles.e2e_custom' });
    expect(created.status).toBe(201);

    const forbiddenUpdate = await request(app!.getHttpServer())
      .patch(`/roles/${created.body.id}`)
      .set('Authorization', `Bearer ${finance.token}`)
      .send({ nameI18nKey: 'core.roles.e2e_custom_renamed' });
    expect(forbiddenUpdate.status).toBe(403);

    const update = await request(app!.getHttpServer())
      .patch(`/roles/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ nameI18nKey: 'core.roles.e2e_custom_renamed' });
    expect(update.status).toBe(200);
    expect(update.body.nameI18nKey).toBe('core.roles.e2e_custom_renamed');

    const del = await request(app!.getHttpServer())
      .delete(`/roles/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(del.status).toBe(204);

    const readerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'reader' } });
    const deleteSystemRole = await request(app!.getHttpServer())
      .delete(`/roles/${readerRole.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    // ForbiddenException from RolesService.remove() — system roles are never deletable.
    expect(deleteSystemRole.status).toBe(403);
  });

  it('assign/unassign a role really changes the target user\'s effective grants on the very next request', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const prisma = app!.get(PrismaService);
    const target = await createUserWithRole(app!, 'reader', { label: 'role-assign-target' });
    const libraryAssistantRole = await prisma.role.findUniqueOrThrow({ where: { code: 'library_assistant' } });

    // Before: reader alone cannot list users (users.view not granted to reader).
    const before = await request(app!.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${target.token}`);
    expect(before.status).toBe(403);

    const assign = await request(app!.getHttpServer())
      .post(`/roles/${libraryAssistantRole.id}/users/${target.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(assign.status).toBe(204);

    // After: same access token, freshly resolved grants (PermissionGuard never caches) -> now allowed.
    const after = await request(app!.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${target.token}`);
    expect(after.status).toBe(200);

    const unassign = await request(app!.getHttpServer())
      .delete(`/roles/${libraryAssistantRole.id}/users/${target.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(unassign.status).toBe(204);

    const afterUnassign = await request(app!.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${target.token}`);
    expect(afterUnassign.status).toBe(403);
  });
});
