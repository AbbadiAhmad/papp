import { BadRequestException, ConflictException, HttpException, HttpStatus, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { AuthService } from '../../../src/core/auth/auth.service';
import { getJwtSecret } from '../../../src/core/auth/jwt.constants';
import { PASSWORD_POLICY_KEY, PasswordPolicy, TOKEN_LIFETIMES_KEY, TokenLifetimes } from '../../../src/core/settings/settings.types';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

const POLICY: PasswordPolicy = {
  minLength: 8,
  requireLetter: true,
  requireNumber: true,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

const LIFETIMES: TokenLifetimes = {
  accessTokenMinutes: 15,
  refreshTokenDays: 30,
  idleTimeoutMinutes: 30,
  absoluteTimeoutDays: 7,
};

const REQUEST_META = { ipAddress: '127.0.0.1', userAgent: 'jest' };

interface MockPrisma {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    count: jest.Mock;
  };
  userSession: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  role: {
    findUnique: jest.Mock;
  };
  userRole: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
}

interface MockJwtService {
  signAsync: jest.Mock;
}

interface MockSettings {
  get: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn() },
    userSession: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    role: { findUnique: jest.fn() },
    userRole: { create: jest.fn() },
    // Real AuthService code only ever calls tx.$executeRaw (the advisory
    // lock) and tx.user.count/create + tx.userRole.create inside the
    // callback — handing back the SAME mock object as `tx` (rather than a
    // separate double) is enough for every test below, since none of them
    // assert transaction isolation itself.
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    $executeRaw: jest.fn().mockResolvedValue(undefined),
  };
  return prisma;
}

function createMockSettings(policy: PasswordPolicy = POLICY, lifetimes: TokenLifetimes = LIFETIMES): MockSettings {
  return {
    get: jest.fn((key: string) => {
      if (key === PASSWORD_POLICY_KEY) return Promise.resolve(policy);
      if (key === TOKEN_LIFETIMES_KEY) return Promise.resolve(lifetimes);
      throw new Error(`Unexpected settings key in test: ${key}`);
    }),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('AuthService', () => {
  let prisma: MockPrisma;
  let jwtService: MockJwtService;
  let settings: MockSettings;
  let service: AuthService;
  let correctPasswordHash: string;

  beforeAll(async () => {
    // Real argon2 hash computed once — AuthService's own login/verify logic
    // is what's under test here, not argon2 itself, and this avoids the
    // fragility of trying to mock a native ESM-wrapped module.
    correctPasswordHash = await argon2.hash('CorrectPass1', { type: argon2.argon2id });
  });

  beforeEach(() => {
    prisma = createMockPrisma();
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed-access-token') };
    settings = createMockSettings();
    service = new AuthService(prisma as never, jwtService as never, settings as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('login', () => {
    function activeUser(overrides: Record<string, unknown> = {}) {
      return {
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: correctPasswordHash,
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...overrides,
      };
    }

    it('issues an access token with exactly {sub, sid} and a high-entropy hashed refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser());
      prisma.user.update.mockResolvedValue({});
      prisma.userSession.create.mockResolvedValue({ id: 'session-1' });

      const tokens = await service.login('user@example.com', 'CorrectPass1', REQUEST_META);

      // Access token payload shape: exactly {sub, sid}, nothing else.
      expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
      const [payload, options] = jwtService.signAsync.mock.calls[0];
      expect(payload).toEqual({ sub: 'user-1', sid: 'session-1' });
      expect(Object.keys(payload).sort()).toEqual(['sid', 'sub']);
      expect(options).toEqual({ secret: getJwtSecret(), expiresIn: '15m' });
      expect(tokens.accessToken).toBe('signed-access-token');

      // Refresh token: high-entropy random value (32 bytes hex = 64 chars),
      // and only its SHA-256 hash — never the raw value — reaches Prisma.
      expect(tokens.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      const createArgs = prisma.userSession.create.mock.calls[0][0];
      expect(createArgs.data.refreshTokenHash).toBe(sha256(tokens.refreshToken));
      expect(createArgs.data.refreshTokenHash).not.toBe(tokens.refreshToken);
      expect(createArgs.data.userId).toBe('user-1');
    });

    it('resets failedLoginAttempts and records lastLoginAt on success', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser({ failedLoginAttempts: 3 }));
      prisma.user.update.mockResolvedValue({});
      prisma.userSession.create.mockResolvedValue({ id: 'session-1' });

      await service.login('user@example.com', 'CorrectPass1', REQUEST_META);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: expect.any(Date) },
      });
    });

    it('rejects an unknown email with a generic message and never touches the DB write path', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('nobody@example.com', 'whatever', REQUEST_META)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });

    it('rejects a deactivated user the same generic way as an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser({ isActive: false }));

      await expect(service.login('user@example.com', 'CorrectPass1', REQUEST_META)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects with 423 Locked when lockedUntil is in the future, without ever checking the password', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser({ lockedUntil: new Date(Date.now() + 60_000) }));

      const promise = service.login('user@example.com', 'CorrectPass1', REQUEST_META);
      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await expect(promise).rejects.toMatchObject({ status: HttpStatus.LOCKED });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('increments failedLoginAttempts on a wrong password without locking below the threshold', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser({ failedLoginAttempts: 1 }));

      await expect(service.login('user@example.com', 'WrongPassword1', REQUEST_META)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginAttempts: 2, lockedUntil: null },
      });
      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });

    it('locks the account and resets the counter on the Nth failed attempt', async () => {
      // maxFailedAttempts = 5: the 5th failure (currently at 4) locks.
      prisma.user.findUnique.mockResolvedValue(activeUser({ failedLoginAttempts: 4 }));

      await expect(service.login('user@example.com', 'WrongPassword1', REQUEST_META)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginAttempts: 0, lockedUntil: expect.any(Date) },
      });
      const lockedUntil: Date = prisma.user.update.mock.calls[0][0].data.lockedUntil;
      const expectedMs = POLICY.lockoutMinutes * MS_PER_MINUTE;
      expect(lockedUntil.getTime() - Date.now()).toBeGreaterThan(expectedMs - 5_000);
      expect(lockedUntil.getTime() - Date.now()).toBeLessThanOrEqual(expectedMs);
    });
  });

  describe('refresh — rotation and reuse detection', () => {
    function activeSession(overrides: Record<string, unknown> = {}) {
      const now = Date.now();
      return {
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: sha256('raw-refresh-token'),
        revokedAt: null,
        expiresAt: new Date(now + 10 * MS_PER_DAY),
        issuedAt: new Date(now - 1 * MS_PER_DAY),
        lastActiveAt: new Date(now - 5 * MS_PER_MINUTE),
        ...overrides,
      };
    }

    it('throws when no refresh token cookie is present', async () => {
      await expect(service.refresh(undefined, REQUEST_META)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
    });

    it('throws when the hash matches no session at all', async () => {
      prisma.userSession.findUnique.mockResolvedValue(null);
      await expect(service.refresh('unknown-token', REQUEST_META)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rotates on a valid, live refresh token: old session revoked, new one issued', async () => {
      prisma.userSession.findUnique.mockResolvedValue(activeSession());
      prisma.userSession.update.mockResolvedValue({});
      prisma.userSession.create.mockResolvedValue({ id: 'session-2' });

      const tokens = await service.refresh('raw-refresh-token', REQUEST_META);

      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.userSession.create).toHaveBeenCalledTimes(1);
      expect(prisma.userSession.create.mock.calls[0][0].data.userId).toBe('user-1');
      expect(tokens.accessToken).toBe('signed-access-token');
    });

    it('detects reuse of an already-revoked refresh token and revokes every session for that user', async () => {
      prisma.userSession.findUnique.mockResolvedValue(activeSession({ revokedAt: new Date() }));

      await expect(service.refresh('raw-refresh-token', REQUEST_META)).rejects.toThrow(/reuse detected/i);

      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // No new session should ever be issued on the reuse-detection path.
      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });

    it('rejects an expired refresh token without touching revocation state', async () => {
      prisma.userSession.findUnique.mockResolvedValue(activeSession({ expiresAt: new Date(Date.now() - 1_000) }));

      await expect(service.refresh('raw-refresh-token', REQUEST_META)).rejects.toThrow(/expired/i);
      expect(prisma.userSession.update).not.toHaveBeenCalled();
      expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
    });

    it('rejects and revokes just past the idle-timeout boundary', async () => {
      const fixedNow = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      const justPastIdle = fixedNow - LIFETIMES.idleTimeoutMinutes * MS_PER_MINUTE - 1_000;
      prisma.userSession.findUnique.mockResolvedValue(
        activeSession({ lastActiveAt: new Date(justPastIdle), issuedAt: new Date(fixedNow - 1 * MS_PER_DAY) }),
      );
      prisma.userSession.update.mockResolvedValue({});

      await expect(service.refresh('raw-refresh-token', REQUEST_META)).rejects.toThrow(/idle timeout/i);
      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });

    it('succeeds just before the idle-timeout boundary', async () => {
      const fixedNow = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      const justBeforeIdle = fixedNow - LIFETIMES.idleTimeoutMinutes * MS_PER_MINUTE + 1_000;
      prisma.userSession.findUnique.mockResolvedValue(
        activeSession({ lastActiveAt: new Date(justBeforeIdle), issuedAt: new Date(fixedNow - 1 * MS_PER_DAY) }),
      );
      prisma.userSession.update.mockResolvedValue({});
      prisma.userSession.create.mockResolvedValue({ id: 'session-2' });

      await expect(service.refresh('raw-refresh-token', REQUEST_META)).resolves.toMatchObject({
        accessToken: 'signed-access-token',
      });
    });

    it('rejects and revokes just past the absolute-timeout boundary', async () => {
      const fixedNow = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      const justPastAbsolute = fixedNow - LIFETIMES.absoluteTimeoutDays * MS_PER_DAY - 1_000;
      prisma.userSession.findUnique.mockResolvedValue(
        activeSession({ issuedAt: new Date(justPastAbsolute), lastActiveAt: new Date(fixedNow - 1_000) }),
      );
      prisma.userSession.update.mockResolvedValue({});

      await expect(service.refresh('raw-refresh-token', REQUEST_META)).rejects.toThrow(/absolute timeout/i);
      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });

    it('succeeds just before the absolute-timeout boundary', async () => {
      const fixedNow = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      const justBeforeAbsolute = fixedNow - LIFETIMES.absoluteTimeoutDays * MS_PER_DAY + 1_000;
      prisma.userSession.findUnique.mockResolvedValue(
        activeSession({ issuedAt: new Date(justBeforeAbsolute), lastActiveAt: new Date(fixedNow - 1_000) }),
      );
      prisma.userSession.update.mockResolvedValue({});
      prisma.userSession.create.mockResolvedValue({ id: 'session-2' });

      await expect(service.refresh('raw-refresh-token', REQUEST_META)).resolves.toMatchObject({
        accessToken: 'signed-access-token',
      });
    });
  });

  describe('logout', () => {
    it('revokes only the named, still-active session', async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('session-1');

      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('forcePasswordChange', () => {
    it('rejects a policy-violating password before ever writing to the user row', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1' });

      await expect(service.forcePasswordChange('user-1', 'short')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('hashes and stores a policy-compliant password and clears mustChangePassword', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1' });
      prisma.user.update.mockResolvedValue({});

      await service.forcePasswordChange('user-1', 'NewPassw0rd');

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const call = prisma.user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'user-1' });
      expect(call.data.mustChangePassword).toBe(false);
      expect(typeof call.data.passwordHash).toBe('string');
      expect(call.data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(call.data.passwordHash).not.toBe('NewPassw0rd');
    });
  });

  describe('isSetupNeeded', () => {
    it('reports true when the users table is empty', async () => {
      prisma.user.count.mockResolvedValue(0);
      await expect(service.isSetupNeeded()).resolves.toBe(true);
    });

    it('reports false once at least one user exists', async () => {
      prisma.user.count.mockResolvedValue(1);
      await expect(service.isSetupNeeded()).resolves.toBe(false);
    });
  });

  describe('setupCreateFirstAdmin', () => {
    const ADMIN_ROLE = { id: 'role-admin', code: 'admin' };
    const SETUP_DTO = { email: 'admin@example.com', name: 'First Admin', password: 'AdminPass1' };

    it('rejects a policy-violating password before checking anything else', async () => {
      await expect(service.setupCreateFirstAdmin({ ...SETUP_DTO, password: 'short' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when the admin role is missing (core migrations never ran)', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.setupCreateFirstAdmin(SETUP_DTO)).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the user, assigns EXACTLY the admin role, and never auto-logs-in (no session/tokens issued)', async () => {
      prisma.role.findUnique.mockResolvedValue(ADMIN_ROLE);
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create = jest.fn().mockResolvedValue({ id: 'user-new', email: SETUP_DTO.email, name: SETUP_DTO.name });
      prisma.userRole.create.mockResolvedValue({});

      const result = await service.setupCreateFirstAdmin(SETUP_DTO);

      expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { code: 'admin' } });
      const createArgs = (prisma.user.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.email).toBe(SETUP_DTO.email);
      expect(createArgs.data.mustChangePassword).toBe(false);
      expect(createArgs.data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(prisma.userRole.create).toHaveBeenCalledWith({ data: { userId: 'user-new', roleId: 'role-admin' } });
      expect(result).toEqual({ id: 'user-new', email: SETUP_DTO.email, name: SETUP_DTO.name });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });

    it('takes the advisory lock BEFORE re-counting users, inside the transaction', async () => {
      prisma.role.findUnique.mockResolvedValue(ADMIN_ROLE);
      const callOrder: string[] = [];
      prisma.$executeRaw.mockImplementation(() => {
        callOrder.push('lock');
        return Promise.resolve(undefined);
      });
      prisma.user.count.mockImplementation(() => {
        callOrder.push('count');
        return Promise.resolve(0);
      });
      prisma.user.create = jest.fn().mockResolvedValue({ id: 'user-new', email: SETUP_DTO.email, name: SETUP_DTO.name });
      prisma.userRole.create.mockResolvedValue({});

      await service.setupCreateFirstAdmin(SETUP_DTO);

      // Real concurrency safety depends on the lock being held for the
      // ENTIRE count-then-insert window, not just called at some point —
      // this only proves ordering, not real cross-connection blocking
      // (impossible to exercise with a mock Prisma), but it does guard
      // against a future refactor silently reordering or dropping the lock.
      expect(callOrder).toEqual(['lock', 'count']);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('rejects with ConflictException when a user already exists by the time the transaction runs (race-safe re-check)', async () => {
      prisma.role.findUnique.mockResolvedValue(ADMIN_ROLE);
      // Simulates a concurrent request (or a stale isSetupNeeded() check on
      // the frontend) that already created the first user before this
      // transaction's own re-check runs.
      prisma.user.count.mockResolvedValue(1);
      prisma.user.create = jest.fn();

      await expect(service.setupCreateFirstAdmin(SETUP_DTO)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.userRole.create).not.toHaveBeenCalled();
    });
  });
});
