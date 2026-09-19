import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UsersService } from '../../../src/core/users/users.service';

/**
 * Root fix for the "can delete/deactivate the last admin" bug: both
 * `UsersService.remove` and `UsersService.update({isActive: false})` must
 * delegate to `RolesService.assertNotLastActiveAdmin` INSIDE the same
 * `$transaction` as the actual write, mirroring the advisory-lock pattern
 * `AuthService.setupCreateFirstAdmin` established (see roles.service.ts's
 * own docblock for the full concurrency reasoning). This file only tests
 * UsersService's OWN delegation/wiring — `RolesService`'s own tests
 * (roles.service.spec.ts) cover `assertNotLastActiveAdmin`'s actual guard
 * logic (counting, the advisory lock, the exact rejection condition).
 */

interface MockPrisma {
  user: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
  $transaction: jest.Mock;
}

interface MockRoles {
  assertNotLastActiveAdmin: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    // Real UsersService code only ever calls tx.user.update/delete inside
    // the callback — handing back the SAME mock object as `tx` is enough
    // here, matching the pattern already established elsewhere.
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
  };
  return prisma;
}

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
    defaultLandingPage: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    ...overrides,
  };
}

describe('UsersService — last-active-admin guard on delete/deactivate', () => {
  let prisma: MockPrisma;
  let roles: MockRoles;
  let service: UsersService;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue(userRow());
    roles = { assertNotLastActiveAdmin: jest.fn().mockResolvedValue(undefined) };
    const settings = { get: jest.fn() };
    const permissions = { getEffectivePermissionCodes: jest.fn() };
    service = new UsersService(prisma as never, settings as never, permissions as never, roles as never);
  });

  describe('remove', () => {
    it('calls assertNotLastActiveAdmin BEFORE deleting, inside the same transaction', async () => {
      prisma.user.delete.mockResolvedValue(userRow());

      await service.remove('user-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(roles.assertNotLastActiveAdmin).toHaveBeenCalledWith(prisma, 'user-1');
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('propagates ForbiddenException from the guard and never deletes the row', async () => {
      roles.assertNotLastActiveAdmin.mockRejectedValue(new ForbiddenException('This is the last active admin account.'));

      await expect(service.remove('user-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });
  });

  describe('update — deactivation path (isActive: false)', () => {
    it('calls assertNotLastActiveAdmin BEFORE deactivating, inside the same transaction', async () => {
      prisma.user.update.mockResolvedValue(userRow({ isActive: false }));

      await service.update('user-1', { isActive: false });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(roles.assertNotLastActiveAdmin).toHaveBeenCalledWith(prisma, 'user-1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({ isActive: false }),
      });
    });

    it('propagates ForbiddenException from the guard and never writes the deactivation', async () => {
      roles.assertNotLastActiveAdmin.mockRejectedValue(new ForbiddenException('This is the last active admin account.'));

      await expect(service.update('user-1', { isActive: false })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does NOT invoke the guard or a transaction for a plain field update (isActive left undefined)', async () => {
      prisma.user.update.mockResolvedValue(userRow({ name: 'Aisha M.' }));

      await service.update('user-1', { name: 'Aisha M.' });

      expect(roles.assertNotLastActiveAdmin).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: expect.objectContaining({ name: 'Aisha M.' }) });
    });

    it('does NOT invoke the guard when REACTIVATING a user (isActive: true) — only deactivation is dangerous', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow({ isActive: false }));
      prisma.user.update.mockResolvedValue(userRow({ isActive: true }));

      await service.update('user-1', { isActive: true });

      expect(roles.assertNotLastActiveAdmin).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
