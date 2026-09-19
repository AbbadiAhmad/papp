import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UsersService } from '../../../src/core/users/users.service';

/**
 * Tier 1 coverage for two additions supporting the real frontend
 * permission-gating model (replacing the old client-side "optimistic until
 * a real 403" cache in apps/web/src/shared/permissions.tsx):
 *  - `UsersService.list()` now eager-loads each user's roles in one query
 *    (never an N+1 per-row lookup) to feed the Users table's read-only
 *    Roles column.
 *  - `UsersService.getMyPermissionCodes()` is the new `GET
 *    /users/me/permissions` endpoint's backing method — a thin delegate to
 *    `PermissionsService.getEffectivePermissionCodes`.
 */

interface MockPrisma {
  user: { findMany: jest.Mock };
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
    userRoles: [],
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

describe('UsersService.list — roles column', () => {
  let prisma: MockPrisma;
  let service: UsersService;

  beforeEach(() => {
    prisma = { user: { findMany: jest.fn() } };
    const settings = { get: jest.fn() };
    const permissions = { getEffectivePermissionCodes: jest.fn() };
    const roles = { assertNotLastActiveAdmin: jest.fn() };
    service = new UsersService(prisma as never, settings as never, permissions as never, roles as never);
  });

  it('eager-loads userRoles.role in ONE query (never a per-row follow-up call)', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.list();

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'asc' },
      include: { userRoles: { include: { role: true } } },
    });
  });

  it('maps each user\'s joined roles onto the presenter\'s roles field', async () => {
    prisma.user.findMany.mockResolvedValue([
      userRow({ id: 'user-1', userRoles: [{ role: roleRow({ code: 'reader' }) }, { role: roleRow({ id: 'role-admin', code: 'admin' }) }] }),
      userRow({ id: 'user-2', userRoles: [] }),
    ]);

    const result = await service.list();

    expect(result[0].roles?.map((r) => r.code)).toEqual(['reader', 'admin']);
    expect(result[1].roles).toEqual([]);
  });

  it('never leaks passwordHash through the roles-bearing presenter shape', async () => {
    prisma.user.findMany.mockResolvedValue([userRow({ userRoles: [{ role: roleRow() }] })]);

    const result = await service.list();

    expect(result[0]).not.toHaveProperty('passwordHash');
  });
});

describe('UsersService.getMyPermissionCodes', () => {
  let prisma: MockPrisma;
  let permissions: MockPermissions;
  let service: UsersService;

  beforeEach(() => {
    prisma = { user: { findMany: jest.fn() } };
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
