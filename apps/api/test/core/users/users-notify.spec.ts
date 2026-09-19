import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UsersService } from '../../../src/core/users/users.service';
import {
  FORCE_PASSWORD_CHANGE_TEMPLATE_KEY,
  PASSWORD_POLICY_KEY,
  PASSWORD_RESET_TEMPLATE_KEY,
} from '../../../src/core/settings/settings.types';

interface MockPrisma {
  user: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
}

const POLICY = { minLength: 8, requireLetter: true, requireNumber: true, maxFailedAttempts: 5, lockoutMinutes: 15 };
const RESET_TEMPLATE = { subject: 'Your password was reset', bodyMarkdown: 'Hi {{name}}, an admin reset your password.' };
const FORCE_TEMPLATE = { subject: 'Password change required', bodyMarkdown: 'Hi {{name}}, please change your password.' };

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'aisha@papp.local',
    name: 'Aisha',
    passwordHash: '$argon2id$existing',
    externalId: null,
    department: null,
    mustChangePassword: false,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    ...overrides,
  };
}

describe('UsersService.update — Notification Center wiring (Phase 4)', () => {
  let prisma: MockPrisma;
  let settings: { get: jest.Mock };
  let permissions: { getEffectivePermissionCodes: jest.Mock };
  let roles: { assertNotLastActiveAdmin: jest.Mock };
  let notifications: { send: jest.Mock };
  let service: UsersService;
  let loggedErrors: jest.Spied<typeof Logger.prototype.error>;

  afterEach(() => {
    loggedErrors.mockRestore();
  });

  beforeEach(() => {
    // The failure-path tests below EXPECT UsersService to log loudly —
    // capture instead of spamming the test run's stderr.
    loggedErrors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    prisma = { user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() } };
    prisma.user.findUnique.mockResolvedValue(userRow());
    prisma.user.update.mockResolvedValue(userRow({ mustChangePassword: true }));

    settings = { get: jest.fn() };
    settings.get.mockImplementation((key: unknown) => {
      switch (key) {
        case PASSWORD_POLICY_KEY:
          return Promise.resolve(POLICY);
        case PASSWORD_RESET_TEMPLATE_KEY:
          return Promise.resolve(RESET_TEMPLATE);
        case FORCE_PASSWORD_CHANGE_TEMPLATE_KEY:
          return Promise.resolve(FORCE_TEMPLATE);
        default:
          return Promise.reject(new Error(`unexpected settings key: ${String(key)}`));
      }
    });

    notifications = { send: jest.fn() };
    notifications.send.mockResolvedValue({ notification: { id: 'n1' }, recipientCount: 1, emailedCount: 0 });

    permissions = { getEffectivePermissionCodes: jest.fn() };
    roles = { assertNotLastActiveAdmin: jest.fn().mockResolvedValue(undefined) };

    service = new UsersService(prisma as never, settings as never, permissions as never, roles as never, notifications as never);
  });

  it('an admin password reset sends the password_reset template as a system notification', async () => {
    await service.update('user-1', { password: 'NewPass123' });

    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith({
      category: 'auth.password_reset',
      title: RESET_TEMPLATE.subject,
      bodyMarkdown: RESET_TEMPLATE.bodyMarkdown,
      targetType: 'user',
      targetId: 'user-1',
      sentBy: null, // system-generated — audited by NotificationsService, not the interceptor
    });
    expect(settings.get).toHaveBeenCalledWith(PASSWORD_RESET_TEMPLATE_KEY);
  });

  it('freshly flipping mustChangePassword on sends the force_password_change template', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow({ mustChangePassword: false }));

    await service.update('user-1', { mustChangePassword: true });

    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'auth.force_password_change',
        title: FORCE_TEMPLATE.subject,
        bodyMarkdown: FORCE_TEMPLATE.bodyMarkdown,
        targetType: 'user',
        targetId: 'user-1',
        sentBy: null,
      }),
    );
  });

  it('the reset notice wins when a password reset also flips mustChangePassword — exactly one send', async () => {
    await service.update('user-1', { password: 'NewPass123', mustChangePassword: true });

    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ category: 'auth.password_reset' }));
  });

  it('does NOT re-notify when mustChangePassword was already true', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow({ mustChangePassword: true }));

    await service.update('user-1', { mustChangePassword: true });

    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('does NOT notify when mustChangePassword is switched off', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow({ mustChangePassword: true }));
    prisma.user.update.mockResolvedValue(userRow({ mustChangePassword: false }));

    await service.update('user-1', { mustChangePassword: false });

    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('does NOT notify on unrelated field updates', async () => {
    prisma.user.update.mockResolvedValue(userRow({ name: 'Aisha M.' }));

    await service.update('user-1', { name: 'Aisha M.', department: 'Library' });

    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('a notification failure never fails the user update itself', async () => {
    notifications.send.mockRejectedValue(new Error('SMTP exploded'));

    const result = await service.update('user-1', { password: 'NewPass123' });

    expect(result.id).toBe('user-1');
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(loggedErrors).toHaveBeenCalled(); // swallowed, but never silently
  });

  it('a missing template setting is swallowed too — the update still succeeds', async () => {
    settings.get.mockImplementation((key: unknown) =>
      key === PASSWORD_POLICY_KEY ? Promise.resolve(POLICY) : Promise.reject(new Error('key missing')),
    );

    const result = await service.update('user-1', { password: 'NewPass123' });

    expect(result.id).toBe('user-1');
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('a fixture without NotificationsService wired logs but does not throw', async () => {
    const bare = new UsersService(prisma as never, settings as never, permissions as never, roles as never);

    const result = await bare.update('user-1', { password: 'NewPass123' });

    expect(result.id).toBe('user-1');
    expect(loggedErrors).toHaveBeenCalled();
  });
});
