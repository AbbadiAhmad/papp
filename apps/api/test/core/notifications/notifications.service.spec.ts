import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotificationsService, SendNotificationInput } from '../../../src/core/notifications/notifications.service';
import { NOTIFICATION_CATEGORIES_KEY } from '../../../src/core/settings/settings.types';

interface MockTx {
  notification: { create: jest.Mock };
  notificationRecipient: { createMany: jest.Mock };
}

interface MockPrisma {
  $transaction: jest.Mock;
  user: { findUnique: jest.Mock; findMany: jest.Mock };
  role: { findUnique: jest.Mock };
  notificationRecipient: { update: jest.Mock };
}

function createdNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    category: 'system.announcement',
    title: 'Hello {{name}}',
    bodyMarkdown: 'Body for **{{name}}**',
    sentBy: null,
    targetType: 'user',
    targetId: 'u1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

describe('NotificationsService.send', () => {
  let tx: MockTx;
  let prisma: MockPrisma;
  let settings: { get: jest.Mock };
  let email: { send: jest.Mock };
  let writer: { write: jest.Mock };
  let service: NotificationsService;

  const alice = { id: 'u1', email: 'alice@papp.local', name: 'Alice' };
  const bob = { id: 'u2', email: 'bob@papp.local', name: 'Bob' };
  const carol = { id: 'u3', email: 'carol@papp.local', name: 'Carol' };

  beforeEach(() => {
    tx = {
      notification: { create: jest.fn() },
      notificationRecipient: { createMany: jest.fn() },
    };
    tx.notification.create.mockResolvedValue(createdNotification());
    tx.notificationRecipient.createMany.mockResolvedValue({ count: 0 });

    prisma = {
      // Runs the callback against the mock tx client, like the real thing.
      $transaction: jest.fn((cb: (t: MockTx) => unknown) => Promise.resolve(cb(tx))),
      user: { findUnique: jest.fn(), findMany: jest.fn() },
      role: { findUnique: jest.fn() },
      notificationRecipient: { update: jest.fn() },
    };
    prisma.notificationRecipient.update.mockResolvedValue({});

    settings = { get: jest.fn() };
    settings.get.mockResolvedValue({}); // default: no category emails

    email = { send: jest.fn() };
    email.send.mockResolvedValue(true);

    writer = { write: jest.fn() };
    writer.write.mockResolvedValue(undefined);

    service = new NotificationsService(prisma as never, settings as never, email as never, writer as never);
  });

  function baseInput(overrides: Partial<SendNotificationInput> = {}): SendNotificationInput {
    return {
      category: 'system.announcement',
      title: 'Hello {{name}}',
      bodyMarkdown: 'Body for **{{name}}**',
      targetType: 'user',
      targetId: 'u1',
      sentBy: 'admin-1',
      ...overrides,
    };
  }

  describe('target shape validation', () => {
    it("rejects a targetId together with 'all_users'", async () => {
      await expect(service.send(baseInput({ targetType: 'all_users', targetId: 'u1' }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("requires a targetId for 'user' and 'role' targets", async () => {
      await expect(service.send(baseInput({ targetType: 'user', targetId: null }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.send(baseInput({ targetType: 'role', targetId: null }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("'user' target", () => {
    it('fans out to exactly one recipient row for the named user', async () => {
      prisma.user.findUnique.mockResolvedValue(alice);

      const result = await service.send(baseInput());

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: { id: true, email: true, name: true },
      });
      expect(tx.notificationRecipient.createMany).toHaveBeenCalledWith({
        data: [{ notificationId: 'notif-1', userId: 'u1' }],
      });
      expect(result.recipientCount).toBe(1);
    });

    it('404s on an unknown target user before creating anything', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.send(baseInput())).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("'role' target", () => {
    it('resolves the CURRENT holders at send time — a membership change is reflected by the next send', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1', code: 'librarian' });
      prisma.user.findMany.mockResolvedValueOnce([alice, bob]);

      const first = await service.send(baseInput({ targetType: 'role', targetId: 'r1' }));

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true, userRoles: { some: { roleId: 'r1' } } },
        select: { id: true, email: true, name: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(first.recipientCount).toBe(2);
      expect(tx.notificationRecipient.createMany).toHaveBeenLastCalledWith({
        data: [
          { notificationId: 'notif-1', userId: 'u1' },
          { notificationId: 'notif-1', userId: 'u2' },
        ],
      });

      // Membership changed between the two sends: Alice left, Carol joined.
      prisma.user.findMany.mockResolvedValueOnce([bob, carol]);

      const second = await service.send(baseInput({ targetType: 'role', targetId: 'r1' }));

      expect(prisma.user.findMany).toHaveBeenCalledTimes(2); // never a cached list
      expect(second.recipientCount).toBe(2);
      expect(tx.notificationRecipient.createMany).toHaveBeenLastCalledWith({
        data: [
          { notificationId: 'notif-1', userId: 'u2' },
          { notificationId: 'notif-1', userId: 'u3' },
        ],
      });
    });

    it('404s on an unknown role before creating anything', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.send(baseInput({ targetType: 'role', targetId: 'missing' }))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the notification but no recipient rows for a role with zero holders', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.send(baseInput({ targetType: 'role', targetId: 'r1' }));

      expect(tx.notification.create).toHaveBeenCalled();
      expect(tx.notificationRecipient.createMany).not.toHaveBeenCalled();
      expect(result.recipientCount).toBe(0);
      expect(result.emailedCount).toBe(0);
    });
  });

  describe("'all_users' target", () => {
    it('fans out to every active user, with a null stored targetId', async () => {
      prisma.user.findMany.mockResolvedValue([alice, bob, carol]);

      const result = await service.send(baseInput({ targetType: 'all_users', targetId: null }));

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: { id: true, email: true, name: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(tx.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ targetType: 'all_users', targetId: null }),
      });
      expect(result.recipientCount).toBe(3);
      expect(tx.notificationRecipient.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'notif-1', userId: 'u1' },
          { notificationId: 'notif-1', userId: 'u2' },
          { notificationId: 'notif-1', userId: 'u3' },
        ],
      });
    });
  });

  describe('atomicity shape', () => {
    it('creates the notification AND its recipient rows through the same $transaction client', async () => {
      prisma.user.findUnique.mockResolvedValue(alice);

      await service.send(baseInput());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Both writes went through the tx client handed to the callback —
      // there is no top-level prisma.notification model on the mock at all,
      // so a write outside the transaction would have thrown.
      expect(tx.notification.create).toHaveBeenCalledTimes(1);
      expect(tx.notificationRecipient.createMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('email channel', () => {
    it('emails each recipient when the category has email enabled, with per-recipient {{name}} substitution', async () => {
      settings.get.mockResolvedValue({ 'system.announcement': { email: true } });
      prisma.role.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.user.findMany.mockResolvedValue([alice, bob]);

      const result = await service.send(baseInput({ targetType: 'role', targetId: 'r1' }));

      expect(settings.get).toHaveBeenCalledWith(NOTIFICATION_CATEGORIES_KEY);
      expect(email.send).toHaveBeenCalledTimes(2);
      expect(email.send).toHaveBeenNthCalledWith(1, {
        to: 'alice@papp.local',
        subject: 'Hello Alice',
        text: 'Body for **Alice**',
        html: expect.stringContaining('<strong>Alice</strong>'),
      });
      expect(email.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: 'bob@papp.local', subject: 'Hello Bob' }));
      expect(result.emailedCount).toBe(2);
    });

    it('sends NO email for a category absent from the config (in-app only default)', async () => {
      settings.get.mockResolvedValue({ 'some.other_category': { email: true } });
      prisma.user.findUnique.mockResolvedValue(alice);

      const result = await service.send(baseInput());

      expect(email.send).not.toHaveBeenCalled();
      expect(result.emailedCount).toBe(0);
      expect(result.recipientCount).toBe(1); // the in-app row still fanned out
    });

    it('sends NO email when the category is present but email: false', async () => {
      settings.get.mockResolvedValue({ 'system.announcement': { email: false } });
      prisma.user.findUnique.mockResolvedValue(alice);

      const result = await service.send(baseInput());

      expect(email.send).not.toHaveBeenCalled();
      expect(result.emailedCount).toBe(0);
    });

    it('stamps emailed_at only for delivered recipients — a failed delivery leaves it unstamped', async () => {
      settings.get.mockResolvedValue({ 'system.announcement': { email: true } });
      prisma.role.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.user.findMany.mockResolvedValue([alice, bob]);
      email.send.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const result = await service.send(baseInput({ targetType: 'role', targetId: 'r1' }));

      expect(result.emailedCount).toBe(1);
      expect(prisma.notificationRecipient.update).toHaveBeenCalledTimes(1);
      expect(prisma.notificationRecipient.update).toHaveBeenCalledWith({
        where: { notificationId_userId: { notificationId: 'notif-1', userId: 'u1' } },
        data: { emailedAt: expect.any(Date) },
      });
    });

    it('email-channel failure never fails the send — the in-app rows already exist', async () => {
      settings.get.mockResolvedValue({ 'system.announcement': { email: true } });
      prisma.user.findUnique.mockResolvedValue(alice);
      // NotificationEmailService.send resolves false on failure by contract
      // (it never throws) — the send must still succeed.
      email.send.mockResolvedValue(false);

      const result = await service.send(baseInput());

      expect(result.recipientCount).toBe(1);
      expect(result.emailedCount).toBe(0);
      expect(prisma.notificationRecipient.update).not.toHaveBeenCalled();
    });

    it('a failing emailed_at stamp is swallowed (logged) — the email was already delivered', async () => {
      const loggedErrors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        settings.get.mockResolvedValue({ 'system.announcement': { email: true } });
        prisma.user.findUnique.mockResolvedValue(alice);
        prisma.notificationRecipient.update.mockRejectedValue(new Error('db hiccup'));

        const result = await service.send(baseInput());

        expect(result.emailedCount).toBe(1);
        expect(loggedErrors).toHaveBeenCalled();
      } finally {
        loggedErrors.mockRestore();
      }
    });
  });

  describe('audit for system-generated sends', () => {
    it("writes an actor_type='system' audit row when sentBy is null", async () => {
      prisma.user.findUnique.mockResolvedValue(alice);

      await service.send(baseInput({ sentBy: null }));

      expect(writer.write).toHaveBeenCalledTimes(1);
      expect(writer.write).toHaveBeenCalledWith({
        actorType: 'system',
        category: 'core.notifications',
        entityType: 'Notification',
        entityId: 'notif-1',
        action: 'create',
        newValue: {
          category: 'system.announcement',
          title: 'Hello {{name}}',
          targetType: 'user',
          targetId: 'u1',
          recipientCount: 1,
        },
      });
    });

    it('writes NO audit row for a person-composed send — the interceptor owns that row', async () => {
      prisma.user.findUnique.mockResolvedValue(alice);

      await service.send(baseInput({ sentBy: 'admin-1' }));

      expect(writer.write).not.toHaveBeenCalled();
    });

    it('a system send with no writer wired logs loudly but still succeeds (fixture-only situation)', async () => {
      const loggedErrors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const bareService = new NotificationsService(prisma as never, settings as never, email as never);
        prisma.user.findUnique.mockResolvedValue(alice);

        const result = await bareService.send(baseInput({ sentBy: null }));

        expect(result.recipientCount).toBe(1);
        expect(loggedErrors).toHaveBeenCalledWith(expect.stringContaining('UNAUDITED'));
      } finally {
        loggedErrors.mockRestore();
      }
    });
  });
});
