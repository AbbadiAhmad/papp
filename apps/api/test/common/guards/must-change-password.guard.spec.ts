import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MustChangePasswordGuard } from '../../../src/common/guards/must-change-password.guard';

interface MockReflector {
  getAllAndOverride: jest.Mock;
}

function createContext(user: Record<string, unknown> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('MustChangePasswordGuard', () => {
  let reflector: MockReflector;
  let guard: MustChangePasswordGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new MustChangePasswordGuard(reflector as never);
  });

  it('blocks the request when mustChangePassword is true and no allow-decorator is present', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createContext({ mustChangePassword: true });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('passes through when the route is marked @AllowMustChangePassword(), even if mustChangePassword is true', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = createContext({ mustChangePassword: true });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('passes through when mustChangePassword is false', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createContext({ mustChangePassword: false });

    expect(guard.canActivate(context)).toBe(true);
  });
});
