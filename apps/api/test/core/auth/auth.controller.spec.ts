import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';
import { AuthController } from '../../../src/core/auth/auth.controller';
import { IssuedTokens, RegisteredUser } from '../../../src/core/auth/auth.service';
import { ForcePasswordChangeDto } from '../../../src/core/auth/dto/force-password-change.dto';
import { LoginDto } from '../../../src/core/auth/dto/login.dto';
import { RegisterDto } from '../../../src/core/auth/dto/register.dto';
import { SetupCreateAdminDto } from '../../../src/core/auth/dto/setup.dto';
import { REFRESH_TOKEN_COOKIE_NAME } from '../../../src/core/auth/jwt.constants';
import { AuthenticatedUser } from '../../../src/common/decorators/current-user.decorator';

/**
 * Tier 1 unit tests for AuthController's OWN logic — cookie handling,
 * request/response shaping and delegation to AuthService — NOT AuthService's
 * internals (see auth.service.spec.ts for those). AuthService and
 * AuditLogWriter are both hand-rolled jest.fn() mocks, matching this
 * module's existing mocking convention; Express's Request/Response are
 * plain object doubles with jest.fn() for every method the controller
 * actually calls (cookie/clearCookie), never a real HTTP server.
 */

interface MockAuthService {
  login: jest.Mock;
  refresh: jest.Mock;
  logout: jest.Mock;
  forcePasswordChange: jest.Mock;
  register: jest.Mock;
  isSetupNeeded: jest.Mock;
  setupCreateFirstAdmin: jest.Mock;
}

interface MockAuditLogWriter {
  write: jest.Mock;
}

function createMockAuthService(): MockAuthService {
  return {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    forcePasswordChange: jest.fn(),
    register: jest.fn(),
    isSetupNeeded: jest.fn(),
    setupCreateFirstAdmin: jest.fn(),
  };
}

function createMockAuditLogWriter(): MockAuditLogWriter {
  return { write: jest.fn().mockResolvedValue(undefined) };
}

function createMockResponse(): Response {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

function createMockRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    cookies: {},
    ip: '203.0.113.5',
    socket: { remoteAddress: '203.0.113.5' },
    headers: { 'user-agent': 'jest-agent' },
    ...overrides,
  } as unknown as Request;
}

const REQUEST_META = { ipAddress: '203.0.113.5', userAgent: 'jest-agent' };

const ISSUED_TOKENS: IssuedTokens = {
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  refreshTokenExpiresAt: new Date('2026-01-01T00:00:00Z'),
  userId: 'user-1',
  sessionId: 'session-1',
};

const AUTH_USER: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'user@example.com',
  mustChangePassword: false,
};

const EXPECTED_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/auth',
  expires: ISSUED_TOKENS.refreshTokenExpiresAt,
};

describe('AuthController', () => {
  let authService: MockAuthService;
  let auditLogWriter: MockAuditLogWriter;
  let controller: AuthController;

  beforeEach(() => {
    authService = createMockAuthService();
    auditLogWriter = createMockAuditLogWriter();
    controller = new AuthController(authService as never, auditLogWriter as never);
  });

  describe('login', () => {
    it('delegates to AuthService, writes a login audit row, sets the refresh cookie, and returns only the access token', async () => {
      authService.login.mockResolvedValue(ISSUED_TOKENS);
      const req = createMockRequest();
      const res = createMockResponse();
      const dto = Object.assign(new LoginDto(), { email: 'user@example.com', password: 'CorrectPass1' });

      const result = await controller.login(dto, req, res);

      expect(authService.login).toHaveBeenCalledWith('user@example.com', 'CorrectPass1', REQUEST_META);
      expect(auditLogWriter.write).toHaveBeenCalledWith({
        actorType: 'user',
        actorUserId: 'user-1',
        actorSessionId: 'session-1',
        category: 'core.auth',
        entityType: 'User',
        entityId: 'user-1',
        action: 'login',
        ipAddress: '203.0.113.5',
        userAgent: 'jest-agent',
      });
      expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE_NAME, 'refresh-token-value', EXPECTED_COOKIE_OPTIONS);
      expect(result).toEqual({ accessToken: 'access-token-value' });
      // Never leaks the refresh token, userId or sessionId in the response body.
      expect(Object.keys(result)).toEqual(['accessToken']);
    });

    it('propagates AuthService.login rejecting bad credentials, writing no audit row and setting no cookie', async () => {
      authService.login.mockRejectedValue(new UnauthorizedException('bad credentials'));
      const req = createMockRequest();
      const res = createMockResponse();
      const dto = Object.assign(new LoginDto(), { email: 'user@example.com', password: 'WrongPassword1' });

      await expect(controller.login(dto, req, res)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(auditLogWriter.write).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('reads the refresh token from the request cookie, rotates it, and sets the new cookie', async () => {
      authService.refresh.mockResolvedValue(ISSUED_TOKENS);
      const req = createMockRequest({ cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'raw-refresh-token' } });
      const res = createMockResponse();

      const result = await controller.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith('raw-refresh-token', REQUEST_META);
      expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE_NAME, 'refresh-token-value', EXPECTED_COOKIE_OPTIONS);
      expect(result).toEqual({ accessToken: 'access-token-value' });
      // refresh() never writes an audit row (rotation is deliberately not a 'login' event).
      expect(auditLogWriter.write).not.toHaveBeenCalled();
    });

    it('passes undefined to AuthService.refresh when no refresh-token cookie is present, and sets no cookie on rejection', async () => {
      authService.refresh.mockRejectedValue(new UnauthorizedException('missing refresh token'));
      const req = createMockRequest({ cookies: {} });
      const res = createMockResponse();

      await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(authService.refresh).toHaveBeenCalledWith(undefined, REQUEST_META);
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the current session, writes a logout audit row, and clears the refresh cookie', async () => {
      authService.logout.mockResolvedValue(undefined);
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.logout(AUTH_USER, req, res);

      expect(authService.logout).toHaveBeenCalledWith('session-1');
      expect(auditLogWriter.write).toHaveBeenCalledWith({
        actorType: 'user',
        actorUserId: 'user-1',
        actorSessionId: 'session-1',
        category: 'core.auth',
        entityType: 'User',
        entityId: 'user-1',
        action: 'logout',
        ipAddress: '203.0.113.5',
        userAgent: 'jest-agent',
      });
      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE_NAME, { path: '/auth' });
      expect(result).toEqual({ success: true });
    });

    it('propagates AuthService.logout rejecting, writing no audit row and clearing no cookie', async () => {
      authService.logout.mockRejectedValue(new Error('session lookup failed'));
      const req = createMockRequest();
      const res = createMockResponse();

      await expect(controller.logout(AUTH_USER, req, res)).rejects.toThrow('session lookup failed');

      expect(auditLogWriter.write).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('forcePasswordChange', () => {
    it('delegates to AuthService with the current user id and the new password', async () => {
      authService.forcePasswordChange.mockResolvedValue(undefined);
      const dto = Object.assign(new ForcePasswordChangeDto(), { newPassword: 'NewPassw0rd' });

      const result = await controller.forcePasswordChange(AUTH_USER, dto);

      expect(authService.forcePasswordChange).toHaveBeenCalledWith('user-1', 'NewPassw0rd');
      expect(result).toEqual({ success: true });
    });

    it('propagates a policy-violation rejection from AuthService', async () => {
      authService.forcePasswordChange.mockRejectedValue(new Error('password does not meet policy'));
      const dto = Object.assign(new ForcePasswordChangeDto(), { newPassword: 'short' });

      await expect(controller.forcePasswordChange(AUTH_USER, dto)).rejects.toThrow('password does not meet policy');
    });
  });

  describe('register', () => {
    it('delegates to AuthService.register and returns its result verbatim (no tokens/session)', async () => {
      const registered: RegisteredUser = { id: 'user-new', email: 'new@example.com', name: 'New User' };
      authService.register.mockResolvedValue(registered);
      const dto = Object.assign(new RegisterDto(), { email: 'new@example.com', name: 'New User', password: 'ValidPass1' });

      const result = await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(registered);
    });

    it('propagates a ForbiddenException when self-registration is disabled', async () => {
      authService.register.mockRejectedValue(new ForbiddenException('self-registration is disabled'));
      const dto = Object.assign(new RegisterDto(), { email: 'x@example.com', name: 'X', password: 'ValidPass1' });

      await expect(controller.register(dto)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getSetupStatus', () => {
    it('reports setupNeeded verbatim from AuthService', async () => {
      authService.isSetupNeeded.mockResolvedValue(true);

      await expect(controller.getSetupStatus()).resolves.toEqual({ setupNeeded: true });
    });

    it('reports setupNeeded: false once a user exists', async () => {
      authService.isSetupNeeded.mockResolvedValue(false);

      await expect(controller.getSetupStatus()).resolves.toEqual({ setupNeeded: false });
    });
  });

  describe('setup', () => {
    it('delegates to AuthService.setupCreateFirstAdmin and returns its result verbatim (no tokens/session)', async () => {
      const created: RegisteredUser = { id: 'user-new', email: 'admin@example.com', name: 'First Admin' };
      authService.setupCreateFirstAdmin.mockResolvedValue(created);
      const dto = Object.assign(new SetupCreateAdminDto(), {
        email: 'admin@example.com',
        name: 'First Admin',
        password: 'AdminPass1',
      });

      const result = await controller.setup(dto);

      expect(authService.setupCreateFirstAdmin).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });

    it('propagates a ConflictException when setup has already been completed', async () => {
      authService.setupCreateFirstAdmin.mockRejectedValue(new ConflictException('Setup has already been completed'));
      const dto = Object.assign(new SetupCreateAdminDto(), {
        email: 'admin@example.com',
        name: 'First Admin',
        password: 'AdminPass1',
      });

      await expect(controller.setup(dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
