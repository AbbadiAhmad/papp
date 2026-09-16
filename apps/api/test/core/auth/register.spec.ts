import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { AuthService } from '../../../src/core/auth/auth.service';
import { RegisterDto } from '../../../src/core/auth/dto/register.dto';
import { ALLOW_SELF_REGISTRATION_KEY, PASSWORD_POLICY_KEY, PasswordPolicy } from '../../../src/core/settings/settings.types';

const POLICY: PasswordPolicy = {
  minLength: 8,
  requireLetter: true,
  requireNumber: true,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

const READER_ROLE = { id: 'role-reader', code: 'reader' };

interface MockTx {
  user: { create: jest.Mock };
  userRole: { create: jest.Mock };
}

/**
 * Deliberately has NO `userSession` (or any token-issuing surface) at all —
 * per BUILD_PLAN.md Phase 5, register() "does not auto-login (201, no
 * tokens)". If AuthService.register ever tried to create a session, this
 * mock would throw a plain TypeError ("Cannot read properties of
 * undefined"), which is a stronger guarantee than merely asserting
 * `toHaveBeenCalledTimes(0)` on a mock that happens to exist.
 */
interface MockPrisma {
  role: { findUnique: jest.Mock };
  $transaction: jest.Mock;
}

interface MockJwtService {
  signAsync: jest.Mock;
}

interface MockSettings {
  get: jest.Mock;
}

function createMockPrisma(tx: MockTx): MockPrisma {
  return {
    role: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx)),
  };
}

function createMockSettings(overrides: { allowSelfRegistration?: boolean; policy?: PasswordPolicy } = {}): MockSettings {
  const allowSelfRegistration = overrides.allowSelfRegistration ?? true;
  const policy = overrides.policy ?? POLICY;
  return {
    get: jest.fn((key: string) => {
      if (key === ALLOW_SELF_REGISTRATION_KEY) return Promise.resolve(allowSelfRegistration);
      if (key === PASSWORD_POLICY_KEY) return Promise.resolve(policy);
      throw new Error(`Unexpected settings key in test: ${key}`);
    }),
  };
}

const VALID_DTO: RegisterDto = Object.assign(new RegisterDto(), {
  email: 'newuser@example.com',
  name: 'New User',
  password: 'ValidPass1',
});

describe('AuthService.register (D41 self-registration)', () => {
  let tx: MockTx;
  let prisma: MockPrisma;
  let jwtService: MockJwtService;
  let service: AuthService;

  beforeEach(() => {
    tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'user-new', email: VALID_DTO.email, name: VALID_DTO.name }) },
      userRole: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = createMockPrisma(tx);
    jwtService = { signAsync: jest.fn() };
  });

  function buildService(settings: MockSettings): AuthService {
    return new AuthService(prisma as never, jwtService as never, settings as never);
  }

  it('rejects before any DB write when self-registration is disabled', async () => {
    prisma.role.findUnique.mockResolvedValue(READER_ROLE);
    service = buildService(createMockSettings({ allowSelfRegistration: false }));

    await expect(service.register(VALID_DTO)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects a policy-violating password without creating a user, even when self-registration is allowed', async () => {
    prisma.role.findUnique.mockResolvedValue(READER_ROLE);
    service = buildService(createMockSettings({ allowSelfRegistration: true }));
    const weakDto = Object.assign(new RegisterDto(), { email: 'weak@example.com', name: 'Weak', password: 'short' });

    await expect(service.register(weakDto)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('creates the user with EXACTLY the reader role, and returns no tokens/session on success', async () => {
    prisma.role.findUnique.mockResolvedValue(READER_ROLE);
    service = buildService(createMockSettings({ allowSelfRegistration: true }));

    const result = await service.register(VALID_DTO);

    expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { code: 'reader' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    const createArgs = tx.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArgs.data.email).toBe(VALID_DTO.email);
    expect(createArgs.data.name).toBe(VALID_DTO.name);
    expect(createArgs.data.mustChangePassword).toBe(false);
    expect(typeof createArgs.data.passwordHash).toBe('string');
    expect(createArgs.data.passwordHash).not.toBe(VALID_DTO.password);
    expect(createArgs.data.passwordHash).toMatch(/^\$argon2id\$/);

    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: 'user-new', roleId: 'role-reader' } });

    // Exactly {id, email, name} — no accessToken/refreshToken/sessionId.
    expect(result).toEqual({ id: 'user-new', email: VALID_DTO.email, name: VALID_DTO.name });
    expect(Object.keys(result).sort()).toEqual(['email', 'id', 'name']);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate email as ConflictException, not the raw Prisma unique-constraint error', async () => {
    prisma.role.findUnique.mockResolvedValue(READER_ROLE);
    service = buildService(createMockSettings({ allowSelfRegistration: true }));
    tx.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );

    await expect(service.register(VALID_DTO)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.userRole.create).not.toHaveBeenCalled();
  });
});
