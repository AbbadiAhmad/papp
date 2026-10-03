import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UsersService } from '../../../src/core/users/users.service';

/**
 * Tier 1 coverage for two things:
 *  - `UsersService.list()` populates `roles` via TWO flat queries
 *    (`userRole.findMany` + `role.findMany`, grouped in application code —
 *    never a nested Prisma `include: { userRoles: { include: { role: true
 *    } } }`, which previously caused real timeouts and was "fixed" by
 *    silently dropping role data from this endpoint entirely instead of
 *    finding a faster equivalent — see root DECISIONS.md). This is what
 *    feeds the Users table's Roles column and the edit dialog's role
 *    checkboxes; both regressed to always-empty when roles were dropped.
 *  - `UsersService.getMyPermissionCodes()` is the `GET /users/me/permissions`
 *    endpoint's backing method — a thin delegate to
 *    `PermissionsService.getEffectivePermissionCodes`.
 */

interface MockPrisma {
  user: { findMany: jest.Mock };
  userRole: { findMany: jest.Mock };
  role: { findMany: jest.Mock };
}

interface MockPermissions {
  getEffectivePermissionCodes: jest.Mock;
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

function roleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'role-reader',
    code: 'reader',
    nameI18nKey: 'core.roles.reader',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function userRoleRow(userId: string, roleId: string) {
  return { userId, roleId, assignedAt: new Date('2026-01-01T00:00:00Z'), assignedBy: null };
}

describe('UsersService.list — roles column', () => {
  let prisma: MockPrisma;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findMany: jest.fn() },
      userRole: { findMany: jest.fn() },
      role: { findMany: jest.fn() },
    };
    const settings = { get: jest.fn() };
    const permissions = { getEffectivePermissionCodes: jest.fn() };
    const roles = { assertNotLastActiveAdmin: jest.fn() };
    service = new UsersService(prisma as never, settings as never, permissions as never, roles as never);
  });

  it('fetches users, user-roles and roles as three separate flat queries — never a nested include', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.userRole.findMany.mockResolvedValue([]);
    prisma.role.findMany.mockResolvedValue([]);

    await service.list();

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'asc' } });
    // Neither call takes an `include` — that nested shape is exactly what
    // previously caused timeouts (root DECISIONS.md).
    expect(prisma.user.findMany.mock.calls[0][0]).not.toHaveProperty('include');
    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.role.findMany).toHaveBeenCalledTimes(1);
  });

  it('populates each user\'s roles from the grouped user_roles/roles data', async () => {
    prisma.user.findMany.mockResolvedValue([userRow({ id: 'user-1' }), userRow({ id: 'user-2' })]);
    prisma.userRole.findMany.mockResolvedValue([
      userRoleRow('user-1', 'role-reader'),
      userRoleRow('user-1', 'role-admin'),
    ]);
    prisma.role.findMany.mockResolvedValue([
      roleRow({ id: 'role-reader', code: 'reader' }),
      roleRow({ id: 'role-admin', code: 'admin' }),
    ]);

    const result = await service.list();

    expect(result).toHaveLength(2);
    const user1 = result.find((u) => u.id === 'user-1')!;
    expect(user1.roles?.map((r) => r.code).sort()).toEqual(['admin', 'reader']);
    const user2 = result.find((u) => u.id === 'user-2')!;
    expect(user2.roles).toEqual([]);
  });

  it('never leaks passwordHash through the roles-bearing presenter shape', async () => {
    prisma.user.findMany.mockResolvedValue([userRow()]);
    prisma.userRole.findMany.mockResolvedValue([userRoleRow('user-1', 'role-reader')]);
    prisma.role.findMany.mockResolvedValue([roleRow()]);

    const result = await service.list();

    expect(result[0]).not.toHaveProperty('passwordHash');
  });
});

describe('UsersService.getMyPermissionCodes', () => {
  let prisma: MockPrisma;
  let permissions: MockPermissions;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findMany: jest.fn() },
      userRole: { findMany: jest.fn() },
      role: { findMany: jest.fn() },
    };
    const settings = { get: jest.fn() };
    permissions = { getEffectivePermissionCodes: jest.fn() };
    const roles = { assertNotLastActiveAdmin: jest.fn() };
    service = new UsersService(prisma as never, settings as never, permissions as never, roles as never);
  });

  it('delegates to PermissionsService.getEffectivePermissionCodes and returns a plain array', async () => {
    permissions.getEffectivePermissionCodes.mockResolvedValue(new Set(['users.view', 'roles.view']));

    const result = await service.getMyPermissionCodes('user-1');

    expect(permissions.getEffectivePermissionCodes).toHaveBeenCalledWith('user-1');
    expect(result.sort()).toEqual(['roles.view', 'users.view']);
  });

  it('returns an empty array for a user with zero grants', async () => {
    permissions.getEffectivePermissionCodes.mockResolvedValue(new Set());

    await expect(service.getMyPermissionCodes('user-1')).resolves.toEqual([]);
  });
});
