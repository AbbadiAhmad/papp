import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard';

interface MockJwtService {
  verifyAsync: jest.Mock;
}

interface MockPrisma {
  userSession: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
}

interface MockReflector {
  getAllAndOverride: jest.Mock;
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

function liveSession(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 'session-1',
    userId: 'user-1',
    revokedAt: null,
    expiresAt: new Date(now + 60_000),
    lastActiveAt: new Date(now),
    user: { isActive: true, email: 'user@example.com' },
    ...overrides,
  };
}

describe('JwtAuthGuard', () => {
  let jwtService: MockJwtService;
  let prisma: MockPrisma;
  let reflector: MockReflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = { userSession: { findUnique: jest.fn(), update: jest.fn() } };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new JwtAuthGuard(jwtService as never, prisma as never, reflector as never);
  });

  it('allows the request without checking the token when isPublic metadata is set', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = createContext({ headers: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', async () => {
    const context = createContext({ headers: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a request whose Authorization header is not a Bearer token', async () => {
    const context = createContext({ headers: { authorization: 'Basic abc123' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid/expired JWT', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const context = createContext({ headers: { authorization: 'Bearer bad-token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a valid JWT whose session no longer exists', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1' });
    prisma.userSession.findUnique.mockResolvedValue(null);
    const context = createContext({ headers: { authorization: 'Bearer good-token' } });

    await expect(guard.canActivate(context)).rejects.toThrow('Session is no longer active');
  });

  it('rejects a valid JWT whose session has been revoked', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1' });
    prisma.userSession.findUnique.mockResolvedValue(liveSession({ revokedAt: new Date() }));
    const context = createContext({ headers: { authorization: 'Bearer good-token' } });

    await expect(guard.canActivate(context)).rejects.toThrow('Session is no longer active');
  });

  it('rejects a valid JWT whose session has expired', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1' });
    prisma.userSession.findUnique.mockResolvedValue(liveSession({ expiresAt: new Date(Date.now() - 1_000) }));
    const context = createContext({ headers: { authorization: 'Bearer good-token' } });

    await expect(guard.canActivate(context)).rejects.toThrow('Session is no longer active');
  });

  it('rejects when the JWT subject does not match the session owner', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'someone-else', sid: 'session-1' });
    prisma.userSession.findUnique.mockResolvedValue(liveSession());
    const context = createContext({ headers: { authorization: 'Bearer good-token' } });

    await expect(guard.canActivate(context)).rejects.toThrow('Token/session mismatch');
  });

  it('rejects when the session user has been deactivated', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1' });
    prisma.userSession.findUnique.mockResolvedValue(liveSession({ user: { isActive: false, email: 'x@example.com' } }));
    const context = createContext({ headers: { authorization: 'Bearer good-token' } });

    await expect(guard.canActivate(context)).rejects.toThrow('User is no longer active');
  });

  it('allows a valid token with a live session and populates request.user', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1' });
    const session = liveSession({ user: { isActive: true, email: 'user@example.com', mustChangePassword: true } });
    prisma.userSession.findUnique.mockResolvedValue(session);
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer good-token' } };
    const context = createContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'user@example.com',
      mustChangePassword: true,
    });
  });

  it('does not touch lastActiveAt when it was updated less than the throttle window ago', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1' });
    const session = liveSession({ lastActiveAt: new Date(Date.now() - 30_000) }); // 30s ago, under the 60s throttle
    prisma.userSession.findUnique.mockResolvedValue(session);
    const context = createContext({ headers: { authorization: 'Bearer good-token' } });

    await guard.canActivate(context);

    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('refreshes lastActiveAt once the throttle window has elapsed', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1' });
    const session = liveSession({ lastActiveAt: new Date(Date.now() - 61_000) }); // just past the 60s throttle
    prisma.userSession.findUnique.mockResolvedValue(session);
    const context = createContext({ headers: { authorization: 'Bearer good-token' } });

    await guard.canActivate(context);

    expect(prisma.userSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { lastActiveAt: expect.any(Date) },
    });
  });
});
