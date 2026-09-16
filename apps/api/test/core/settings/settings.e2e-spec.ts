import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { ALL_ROLE_CODES, expectPermissionEnforced, fixtureForRole } from '../../../../../test/support/permission-matrix';

describe('Settings (e2e)', () => {
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

  describe('permission matrix (users.settings.view / users.settings.update, admin only by default)', () => {
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/settings/password-policy', requiredPermission: 'users.settings.view' });
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/settings/session-timing', requiredPermission: 'users.settings.view' });
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/settings/notification-templates', requiredPermission: 'users.settings.view' });
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/settings/registration', requiredPermission: 'users.settings.view' });

    expectPermissionEnforced({
      app: () => app!,
      method: 'put',
      path: '/settings/password-policy',
      requiredPermission: 'users.settings.update',
      validBody: { minLength: 10, requireLetter: true, requireNumber: true, maxFailedAttempts: 5, lockoutMinutes: 15 },
    });

    expectPermissionEnforced({
      app: () => app!,
      method: 'put',
      path: '/settings/session-timing',
      requiredPermission: 'users.settings.update',
      validBody: { accessTokenMinutes: 15, refreshTokenDays: 30, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 },
    });

    expectPermissionEnforced({
      app: () => app!,
      method: 'put',
      path: '/settings/registration',
      requiredPermission: 'users.settings.update',
      validBody: { allowSelfRegistration: false },
    });

    expectPermissionEnforced({
      app: () => app!,
      method: 'put',
      path: '/settings/notification-templates',
      requiredPermission: 'users.settings.update',
      validBody: {
        templates: { password_reset: { subject: 'Matrix Subject', bodyMarkdown: 'Matrix body {{name}}' } },
      },
    });
  });

  it('a real write is visible on the very next read, and is audited (no @Audit decorator needed — SettingsService writes its own row)', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const write = await request(app!.getHttpServer())
      .put('/settings/session-timing')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ accessTokenMinutes: 20, refreshTokenDays: 30, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    expect(write.status).toBe(200);
    expect(write.body.accessTokenMinutes).toBe(20);

    const read = await request(app!.getHttpServer())
      .get('/settings/session-timing')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(read.status).toBe(200);
    expect(read.body.accessTokenMinutes).toBe(20);

    const { PrismaService } = await import('../../../src/prisma/prisma.service');
    const prisma = app!.get(PrismaService);
    const rowByOccurred = await prisma.auditLog.findFirst({
      where: { category: 'core.settings', actorUserId: admin.userId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(rowByOccurred).not.toBeNull();
  });
});
