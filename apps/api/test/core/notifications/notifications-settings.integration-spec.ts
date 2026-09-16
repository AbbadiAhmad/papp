import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { NotificationsService } from '../../../src/core/notifications/notifications.service';
import { SettingsService } from '../../../src/core/settings/settings.service';
import { PASSWORD_POLICY_KEY, PasswordPolicy } from '../../../src/core/settings/settings.types';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';

/**
 * Tier 2: two real-DB-only guarantees Tier 1's mocked specs
 * (`notifications.service.spec.ts`, `settings-cache.spec.ts`) cannot prove:
 *  1. a 'role' target really resolves against the LIVE `user_roles` table at
 *     the moment of send() — not a snapshot taken earlier — by mutating role
 *     membership between two real sends against the same role.
 *  2. SettingsService's in-memory cache really invalidates against a value
 *     that actually made it to the `system_settings` JSONB column and back.
 */
describe('NotificationsService + SettingsService (integration, real DB)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let notificationsService: NotificationsService;
  let settingsService: SettingsService;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    notificationsService = app.get(NotificationsService);
    settingsService = app.get(SettingsService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  async function createUser(isActive = true): Promise<string> {
    const passwordHash = await argon2.hash('whatever-password', { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, name: 'Notify Test User', passwordHash, isActive },
    });
    return user.id;
  }

  it("a 'role' target resolves against LIVE user_roles at send time — a membership change between two sends changes the second send's recipients", async () => {
    const role = await prisma.role.create({
      data: { code: `it_notif_role_${randomUUID().slice(0, 8)}`, nameI18nKey: 'core.roles.test' },
    });
    const user1 = await createUser();
    const user2 = await createUser();
    const inactiveUser = await createUser(false);

    await prisma.userRole.create({ data: { userId: user1, roleId: role.id } });
    await prisma.userRole.create({ data: { userId: inactiveUser, roleId: role.id } });

    const firstSend = await notificationsService.send({
      category: 'system.announcement',
      title: 'First',
      bodyMarkdown: 'First body',
      targetType: 'role',
      targetId: role.id,
      sentBy: null,
    });
    // Only user1 — the inactive user is excluded (§12.2: role/all_users
    // targets are active-users-only).
    expect(firstSend.recipientCount).toBe(1);
    const firstRecipients = await prisma.notificationRecipient.findMany({
      where: { notificationId: firstSend.notification.id },
    });
    expect(firstRecipients.map((r) => r.userId).sort()).toEqual([user1].sort());

    // Mutate role membership for real, then send again — NOT a cached list.
    await prisma.userRole.create({ data: { userId: user2, roleId: role.id } });

    const secondSend = await notificationsService.send({
      category: 'system.announcement',
      title: 'Second',
      bodyMarkdown: 'Second body',
      targetType: 'role',
      targetId: role.id,
      sentBy: null,
    });
    expect(secondSend.recipientCount).toBe(2);
    const secondRecipients = await prisma.notificationRecipient.findMany({
      where: { notificationId: secondSend.notification.id },
    });
    expect(secondRecipients.map((r) => r.userId).sort()).toEqual([user1, user2].sort());
  });

  it('SettingsService.set() invalidates the cache against a value that actually round-tripped through system_settings JSONB', async () => {
    // Prime the cache with the seeded default (0003_create_system_settings.sql).
    const original = await settingsService.get<PasswordPolicy>(PASSWORD_POLICY_KEY);
    expect(original.minLength).toBe(10);

    const updated: PasswordPolicy = { ...original, minLength: 14, maxFailedAttempts: 7 };
    await settingsService.set(PASSWORD_POLICY_KEY, updated, randomUUID());

    // Read-after-write, same process, immediately — must reflect the write,
    // not the value cached before set() ran.
    const reread = await settingsService.get<PasswordPolicy>(PASSWORD_POLICY_KEY);
    expect(reread.minLength).toBe(14);
    expect(reread.maxFailedAttempts).toBe(7);

    // And the row genuinely persisted in the DB, independent of this
    // process's cache — a brand new read straight off the table agrees.
    const row = await prisma.systemSetting.findUniqueOrThrow({ where: { key: PASSWORD_POLICY_KEY } });
    expect((row.value as PasswordPolicy).minLength).toBe(14);

    // Restore, so this test file doesn't leak state into whichever spec
    // Jest happens to run in the same worker next within this suite.
    await settingsService.set(PASSWORD_POLICY_KEY, original, randomUUID());
  });
});
