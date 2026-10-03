import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PermissionsService } from '../../../src/core/permissions/permissions.service';

interface MockPrisma {
  rolePermission: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    upsert: jest.Mock;
  };
  userRole: {
    findMany: jest.Mock;
  };
  permission: {
    findMany: jest.Mock;
  };
  role: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  return {
    rolePermission: { findMany: jest.fn(), deleteMany: jest.fn(), upsert: jest.fn() },
    userRole: { findMany: jest.fn() },
    permission: { findMany: jest.fn() },
    role: { findUnique: jest.fn() },
    $transaction: jest.fn().mockResolvedValue(undefined),
  };
}

function permissionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'perm-1',
    code: 'sessions.view_my',
    moduleKey: 'core',
    category: 'sessions',
    descriptionI18nKey: 'core.perm.sessions.view_my',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
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

  describe('getMyPermissionDetails', () => {
    it('queries permissions whose role_permissions link back to a role this user holds', async () => {
      prisma.permission.findMany.mockResolvedValue([]);

      await service.getMyPermissionDetails('user-1');

      expect(prisma.permission.findMany).toHaveBeenCalledWith({
        where: { rolePermissions: { some: { role: { userRoles: { some: { userId: 'user-1' } } } } } },
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
      });
    });

    it('returns full catalog rows (code/category/description), not bare codes', async () => {
      prisma.permission.findMany.mockResolvedValue([
        permissionRow({ id: 'perm-1', code: 'sessions.view_my' }),
        permissionRow({
          id: 'perm-2',
          code: 'notifications.view',
          category: 'notifications',
          descriptionI18nKey: 'core.perm.notifications.view',
        }),
      ]);

      const result = await service.getMyPermissionDetails('user-1');

      expect(result).toEqual([
        { id: 'perm-1', code: 'sessions.view_my', moduleKey: 'core', category: 'sessions', descriptionI18nKey: 'core.perm.sessions.view_my' },
        { id: 'perm-2', code: 'notifications.view', moduleKey: 'core', category: 'notifications', descriptionI18nKey: 'core.perm.notifications.view' },
      ]);
    });

    it('returns an empty array for a zero-grant user', async () => {
      prisma.permission.findMany.mockResolvedValue([]);

      await expect(service.getMyPermissionDetails('user-1')).resolves.toEqual([]);
    });
  });

  /**
   * The structural replacement for the old D12 `PermissionsPageGuard`
   * bypass (`docs/DECISIONS.md`, the entry superseding D12 /
   * `ARCHITECTURE.md` §7.4): `admin` can never actually be left holding
   * zero grants for `permissions.view`/`permissions.grant`, because
   * revoking either from `admin` specifically is rejected outright. Every
   * OTHER permission can still be freely revoked from admin, and these two
   * codes can still be freely revoked from any OTHER role.
   */
  describe('setRoleGrants — protected admin grants', () => {
    function roleRow(overrides: Record<string, unknown> = {}) {
      return { id: 'role-1', code: 'admin', nameI18nKey: 'roles.admin', isSystem: true, ...overrides };
    }

    beforeEach(() => {
      // setRoleGrants re-validates every code against the live catalog —
      // the tests below always submit a set that fully round-trips.
      prisma.rolePermission.deleteMany.mockResolvedValue({ count: 0 });
      prisma.rolePermission.upsert.mockResolvedValue({});
      prisma.rolePermission.findMany.mockResolvedValue([]);
    });

    it('rejects revoking permissions.view from the admin role', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow());
      prisma.permission.findMany.mockResolvedValue([{ id: 'perm-grant', code: 'permissions.grant' }]);

      await expect(service.setRoleGrants('role-1', ['permissions.grant'])).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects revoking permissions.grant from the admin role', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow());
      prisma.permission.findMany.mockResolvedValue([{ id: 'perm-view', code: 'permissions.view' }]);

      await expect(service.setRoleGrants('role-1', ['permissions.view'])).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows revoking some OTHER permission from admin as long as both protected codes remain', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow());
      prisma.permission.findMany.mockResolvedValue([
        { id: 'perm-view', code: 'permissions.view' },
        { id: 'perm-grant', code: 'permissions.grant' },
      ]);
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { code: 'permissions.view' } },
        { permission: { code: 'permissions.grant' } },
      ]);

      await expect(
        service.setRoleGrants('role-1', ['permissions.view', 'permissions.grant']),
      ).resolves.toEqual(['permissions.grant', 'permissions.view']);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('allows revoking permissions.view/permissions.grant from a NON-admin role', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow({ id: 'role-2', code: 'finance', isSystem: true }));
      prisma.permission.findMany.mockResolvedValue([]);

      await expect(service.setRoleGrants('role-2', [])).resolves.toEqual([]);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
