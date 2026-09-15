import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PermissionsPageGuard } from '../../../src/core/permissions/permissions-page.guard';

interface MockReflector {
  getAllAndOverride: jest.Mock;
}

interface MockPermissionsService {
  getRoleCodesForUser: jest.Mock;
  getEffectivePermissionCodes: jest.Mock;
}

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const authenticatedRequest = () => ({
  user: { userId: 'user-1', sessionId: 'session-1', email: 'user@example.com', mustChangePassword: false },
});

/**
 * D12 (ARCHITECTURE.md §7.4): admin ALWAYS reaches the Permissions page —
 * the single sanctioned role-name check in the codebase. These tests pin
 * both halves of that contract: the bypass works for admin, and everyone
 * else goes through the normal permission check with no shortcut.
 */
describe('PermissionsPageGuard (D12)', () => {
  let reflector: MockReflector;
  let permissionsService: MockPermissionsService;
  let guard: PermissionsPageGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue('permissions.manage') };
    permissionsService = { getRoleCodesForUser: jest.fn(), getEffectivePermissionCodes: jest.fn() };
    guard = new PermissionsPageGuard(reflector as never, permissionsService as never);
  });

  it('allows an admin WITHOUT ever consulting effective permissions', async () => {
    permissionsService.getRoleCodesForUser.mockResolvedValue(['admin']);
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // The bypass is by ROLE CODE alone — even an admin whose permission
    // grants were entirely revoked must still get in (that is the point of D12).
    expect(permissionsService.getEffectivePermissionCodes).not.toHaveBeenCalled();
  });

  it('allows a user holding admin among several roles', async () => {
    permissionsService.getRoleCodesForUser.mockResolvedValue(['reader', 'admin']);
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.getEffectivePermissionCodes).not.toHaveBeenCalled();
  });

  it('allows a non-admin who holds the required permission', async () => {
    permissionsService.getRoleCodesForUser.mockResolvedValue(['library_assistant']);
    permissionsService.getEffectivePermissionCodes.mockResolvedValue(new Set(['permissions.manage']));
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.getEffectivePermissionCodes).toHaveBeenCalledWith('user-1');
  });

  it('rejects a non-admin without the required permission with ForbiddenException', async () => {
    permissionsService.getRoleCodesForUser.mockResolvedValue(['reader']);
    permissionsService.getEffectivePermissionCodes.mockResolvedValue(new Set(['users.read']));
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not treat a role merely containing the substring "admin" as admin', async () => {
    permissionsService.getRoleCodesForUser.mockResolvedValue(['administrative_assistant']);
    permissionsService.getEffectivePermissionCodes.mockResolvedValue(new Set());
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissionsService.getEffectivePermissionCodes).toHaveBeenCalled();
  });

  it('throws UnauthorizedException when request.user is missing', async () => {
    const context = createContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(permissionsService.getRoleCodesForUser).not.toHaveBeenCalled();
    expect(permissionsService.getEffectivePermissionCodes).not.toHaveBeenCalled();
  });

  it('lets a non-admin through an undecorated handler without a permission lookup', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    permissionsService.getRoleCodesForUser.mockResolvedValue(['reader']);
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.getEffectivePermissionCodes).not.toHaveBeenCalled();
  });

  it('resolves role codes FRESH on every single canActivate call (no caching)', async () => {
    permissionsService.getRoleCodesForUser.mockResolvedValue(['admin']);
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(permissionsService.getRoleCodesForUser).toHaveBeenCalledTimes(2);
    expect(permissionsService.getRoleCodesForUser).toHaveBeenNthCalledWith(1, 'user-1');
    expect(permissionsService.getRoleCodesForUser).toHaveBeenNthCalledWith(2, 'user-1');
  });

  it('reflects an admin-role removal between two calls on the same guard instance', async () => {
    permissionsService.getRoleCodesForUser.mockResolvedValueOnce(['admin']).mockResolvedValueOnce(['reader']);
    permissionsService.getEffectivePermissionCodes.mockResolvedValue(new Set());
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
