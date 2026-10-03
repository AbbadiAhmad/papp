import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PermissionGuard } from '../../../src/common/guards/permission.guard';
import { IS_PUBLIC_KEY } from '../../../src/common/decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../../src/common/decorators/require-permission.decorator';

interface MockReflector {
  getAllAndOverride: jest.Mock;
}

interface MockPermissionsService {
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
 * The guard checks TWO distinct reflector keys per call (required-permission
 * → is-public), so the mock must answer by key rather than a single blanket
 * `mockReturnValue` — otherwise a value meant for one key (e.g. the
 * required-permission string) leaks into the other. `metadata()` below sets
 * up per-key answers explicitly.
 */
function metadata(reflector: MockReflector, values: { requiredPermission?: string; isPublic?: boolean }): void {
  reflector.getAllAndOverride.mockImplementation((key: unknown) => {
    if (key === REQUIRE_PERMISSION_KEY) return values.requiredPermission;
    if (key === IS_PUBLIC_KEY) return values.isPublic;
    throw new Error(`Unexpected reflector key in test: ${String(key)}`);
  });
}

describe('PermissionGuard', () => {
  let reflector: MockReflector;
  let permissionsService: MockPermissionsService;
  let guard: PermissionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    metadata(reflector, {});
    permissionsService = { getEffectivePermissionCodes: jest.fn() };
    guard = new PermissionGuard(reflector as never, permissionsService as never);
  });

  it('lets an undecorated handler through without ever resolving permissions', async () => {
    metadata(reflector, {});
    // Deliberately no request.user either — an undecorated handler must pass
    // before the guard even looks at the request (the /me endpoints case).
    const context = createContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.getEffectivePermissionCodes).not.toHaveBeenCalled();
  });

  it('allows a decorated handler when the caller holds the required permission', async () => {
    metadata(reflector, { requiredPermission: 'users.read' });
    permissionsService.getEffectivePermissionCodes.mockResolvedValue(new Set(['users.read', 'users.create']));
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.getEffectivePermissionCodes).toHaveBeenCalledWith('user-1');
  });

  it('throws ForbiddenException when the caller lacks the required permission', async () => {
    metadata(reflector, { requiredPermission: 'roles.manage' });
    permissionsService.getEffectivePermissionCodes.mockResolvedValue(new Set(['users.read']));
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('Missing required permission: roles.manage');
  });

  it('throws ForbiddenException when the caller has no permissions at all', async () => {
    metadata(reflector, { requiredPermission: 'users.read' });
    permissionsService.getEffectivePermissionCodes.mockResolvedValue(new Set());
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws UnauthorizedException when request.user is missing on a decorated, non-public handler', async () => {
    metadata(reflector, { requiredPermission: 'users.read' });
    const context = createContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(permissionsService.getEffectivePermissionCodes).not.toHaveBeenCalled();
  });

  it('resolves effective permissions FRESH on every single canActivate call (no caching)', async () => {
    // The freshness contract (ARCHITECTURE.md §7.2): a grant change must be
    // visible on the very next request, so the guard must hit the resolver
    // once per invocation — never memoize per user or per process.
    metadata(reflector, { requiredPermission: 'users.read' });
    permissionsService.getEffectivePermissionCodes.mockResolvedValue(new Set(['users.read']));
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(permissionsService.getEffectivePermissionCodes).toHaveBeenCalledTimes(2);
    expect(permissionsService.getEffectivePermissionCodes).toHaveBeenNthCalledWith(1, 'user-1');
    expect(permissionsService.getEffectivePermissionCodes).toHaveBeenNthCalledWith(2, 'user-1');
  });

  it('reflects a grant revocation between two calls on the same guard instance', async () => {
    metadata(reflector, { requiredPermission: 'users.read' });
    permissionsService.getEffectivePermissionCodes
      .mockResolvedValueOnce(new Set(['users.read']))
      .mockResolvedValueOnce(new Set());
    const context = createContext(authenticatedRequest());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an anonymous request on a @Public() route with no permission check', async () => {
    metadata(reflector, { requiredPermission: 'users.read', isPublic: true });
    const context = createContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.getEffectivePermissionCodes).not.toHaveBeenCalled();
  });
});
