import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PermissionsService } from '../../../src/core/permissions/permissions.service';

interface MockPrisma {
  rolePermission: {
    findMany: jest.Mock;
  };
  userRole: {
    findMany: jest.Mock;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    rolePermission: { findMany: jest.fn() },
    userRole: { findMany: jest.fn() },
  };
}

describe('PermissionsService', () => {
  let prisma: MockPrisma;
  let service: PermissionsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PermissionsService(prisma as never);
  });

  describe('getEffectivePermissionCodes', () => {
    it('joins role_permissions through the user_roles relation for exactly this user', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([]);

      await service.getEffectivePermissionCodes('user-1');

      // The query shape IS the contract: resolution must go through the live
      // user_roles -> role_permissions join (never a cache, never a JWT claim).
      expect(prisma.rolePermission.findMany).toHaveBeenCalledWith({
        where: { role: { userRoles: { some: { userId: 'user-1' } } } },
        select: { permission: { select: { code: true } } },
      });
    });

    it('returns the union of codes across roles as a Set, deduplicating overlaps', async () => {
      // users.read granted via two different roles — must appear once.
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { code: 'users.read' } },
        { permission: { code: 'users.create' } },
        { permission: { code: 'users.read' } },
      ]);

      const codes = await service.getEffectivePermissionCodes('user-1');

      expect(codes).toBeInstanceOf(Set);
      expect(codes.size).toBe(2);
      expect(codes.has('users.read')).toBe(true);
      expect(codes.has('users.create')).toBe(true);
    });

    it('returns an empty Set for a user with no roles or no grants', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([]);

      const codes = await service.getEffectivePermissionCodes('user-without-roles');

      expect(codes).toBeInstanceOf(Set);
      expect(codes.size).toBe(0);
    });

    it('queries fresh on every call — two calls, two queries', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ permission: { code: 'users.read' } }]);

      await service.getEffectivePermissionCodes('user-1');
      await service.getEffectivePermissionCodes('user-1');

      expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRoleCodesForUser', () => {
    it('resolves role codes via user_roles with the role included', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { userId: 'user-1', roleId: 'r1', role: { id: 'r1', code: 'admin' } },
        { userId: 'user-1', roleId: 'r2', role: { id: 'r2', code: 'reader' } },
      ]);

      const codes = await service.getRoleCodesForUser('user-1');

      expect(prisma.userRole.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { role: true },
      });
      expect(codes).toEqual(['admin', 'reader']);
    });

    it('returns an empty array for a user with no roles', async () => {
      prisma.userRole.findMany.mockResolvedValue([]);

      await expect(service.getRoleCodesForUser('user-1')).resolves.toEqual([]);
    });
  });
});
