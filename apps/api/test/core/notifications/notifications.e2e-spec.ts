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

describe('Notifications (e2e)', () => {
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
    // notifications.send: admin only by default.
    expectPermissionEnforced({
      app: () => app!,
      method: 'post',
      path: '/notifications',
      requiredPermission: 'notifications.send',
      validBody: { category: 'system.announcement', title: 'Matrix', bodyMarkdown: 'hello', targetType: 'all_users' },
      // Multiple sends against 'all_users' are harmless (no uniqueness constraint) so all 4 roles can run.
    });

    // notifications.view is granted to ALL FOUR base roles by default — the
    // matrix still proves the real success path + real 401 for anonymous.
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/notifications/me', requiredPermission: 'notifications.view' });
  });

  it('a real send fans out an in-app inbox row to the targeted user, who can then mark it read', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const recipient = await createUserWithRole(app!, 'reader', { label: 'notif-recipient' });

    const send = await request(app!.getHttpServer())
      .post('/notifications')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        category: 'system.announcement',
        title: 'New books arrived',
        bodyMarkdown: 'Hello {{name}}, check the catalog.',
        targetType: 'user',
        targetId: recipient.userId,
      });
    expect(send.status).toBe(201);
    expect(send.body.recipientCount).toBe(1);

    const inbox = await request(app!.getHttpServer())
      .get('/notifications/me')
      .set('Authorization', `Bearer ${recipient.token}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.unreadCount).toBeGreaterThanOrEqual(1);
    const item = inbox.body.notifications.find((n: { notificationId: string }) => n.notificationId === send.body.id);
    expect(item).toBeDefined();
    expect(item.readAt).toBeNull();
    expect(item.bodyHtml).toContain('Hello');

    const markRead = await request(app!.getHttpServer())
      .patch(`/notifications/${send.body.id}/read`)
      .set('Authorization', `Bearer ${recipient.token}`);
    expect(markRead.status).toBe(200);
    expect(markRead.body.readAt).not.toBeNull();

    const prisma = app!.get(PrismaService);
    const row = await prisma.auditLog.findFirst({
      where: { category: 'core.notifications', action: 'update', entityId: send.body.id },
    });
    expect(row).not.toBeNull();
  });

  it('401s /notifications and /notifications/me anonymously', async () => {
    const send = await request(app!.getHttpServer())
      .post('/notifications')
      .send({ category: 'x', title: 'x', bodyMarkdown: 'x', targetType: 'all_users' });
    expect(send.status).toBe(401);

    const inbox = await request(app!.getHttpServer()).get('/notifications/me');
    expect(inbox.status).toBe(401);
  });
});
