import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { AuthService } from '../../../src/core/auth/auth.service';
import { RegisterDto } from '../../../src/core/auth/dto/register.dto';
import {
  ALLOW_SELF_REGISTRATION_KEY,
  PASSWORD_POLICY_KEY,
  PasswordPolicy,
  SELF_REGISTRATION_ROLE_CODE_KEY,
} from '../../../src/core/settings/settings.types';

const POLICY: PasswordPolicy = {
  minLength: 8,
  requireLetter: true,
  requireNumber: true,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

// D91: no base role is hardcoded any more — the configured role is
// whatever an admin picked (could be any role in a given deployment, not
// just the four seeded ones), so these are deliberately arbitrary/
// non-base-role names, to make sure nothing in AuthService secretly still
// assumes "reader".
const CONFIGURED_ROLE = { id: 'role-custom-member', code: 'member' };

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
  user: { findUnique: jest.Mock };
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
    // D92: defaults to "no existing user" so every test not specifically
    // about the duplicate-email case doesn't have to care about it.
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    role: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx)),
  };
}

function createMockSettings(
  overrides: { allowSelfRegistration?: boolean; selfRegistrationRoleCode?: string | null; policy?: PasswordPolicy } = {},
): MockSettings {
  const allowSelfRegistration = overrides.allowSelfRegistration ?? true;
  // Distinguishes "not passed" (defaults to a configured role, so most
  // tests don't need to care) from an explicit `null` (D91: migration
  // 0013's actual seeded default — a role must be set by an admin, never
  // assumed) — a plain `??` would conflate the two, since `null` and
  // `undefined` both trigger its fallback.
  const selfRegistrationRoleCode = 'selfRegistrationRoleCode' in overrides ? overrides.selfRegistrationRoleCode : CONFIGURED_ROLE.code;
  const policy = overrides.policy ?? POLICY;
  return {
    get: jest.fn((key: string) => {
      if (key === ALLOW_SELF_REGISTRATION_KEY) return Promise.resolve(allowSelfRegistration);
      if (key === SELF_REGISTRATION_ROLE_CODE_KEY) return Promise.resolve(selfRegistrationRoleCode);
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

  // D92: found via a real user report — self-registering with an email
  // that already existed (created separately via the admin "create user"
  // screen, nothing to do with self-registration at all) returned "no role
  // configured" instead of "this email is taken", because the original
  // code checked server config before ever looking at the registrant's own
  // input. The duplicate-email check must win regardless of config state.
  it('rejects a duplicate email with ConflictException BEFORE checking whether self-registration is even enabled', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user', email: VALID_DTO.email });
    service = buildService(createMockSettings({ allowSelfRegistration: false }));

    await expect(service.register(VALID_DTO)).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: VALID_DTO.email } });
    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email with ConflictException even when no role is configured either', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user', email: VALID_DTO.email });
    service = buildService(createMockSettings({ allowSelfRegistration: true, selfRegistrationRoleCode: null }));

    await expect(service.register(VALID_DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects before any DB write when self-registration is disabled', async () => {
    prisma.role.findUnique.mockResolvedValue(CONFIGURED_ROLE);
    service = buildService(createMockSettings({ allowSelfRegistration: false }));

    await expect(service.register(VALID_DTO)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: VALID_DTO.email } });
    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects (ForbiddenException, not a 500) when self-registration is on but no role is configured — D91 default, migration 0013', async () => {
    prisma.role.findUnique.mockResolvedValue(CONFIGURED_ROLE);
    service = buildService(createMockSettings({ allowSelfRegistration: true, selfRegistrationRoleCode: null }));

    await expect(service.register(VALID_DTO)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('rejects (ForbiddenException, not a 500) when the configured role code no longer exists', async () => {
    prisma.role.findUnique.mockResolvedValue(null);
    service = buildService(createMockSettings({ allowSelfRegistration: true, selfRegistrationRoleCode: 'deleted_role' }));

    await expect(service.register(VALID_DTO)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { code: 'deleted_role' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('rejects a policy-violating password without creating a user, even when self-registration is allowed', async () => {
    prisma.role.findUnique.mockResolvedValue(CONFIGURED_ROLE);
    service = buildService(createMockSettings({ allowSelfRegistration: true }));
    const weakDto = Object.assign(new RegisterDto(), { email: 'weak@example.com', name: 'Weak', password: 'short' });

    await expect(service.register(weakDto)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('creates the user with EXACTLY the admin-configured role (never a hardcoded one), and returns no tokens/session on success', async () => {
    prisma.role.findUnique.mockResolvedValue(CONFIGURED_ROLE);
    service = buildService(createMockSettings({ allowSelfRegistration: true }));

    const result = await service.register(VALID_DTO);

    expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { code: CONFIGURED_ROLE.code } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    const createArgs = tx.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArgs.data.email).toBe(VALID_DTO.email);
    expect(createArgs.data.name).toBe(VALID_DTO.name);
    expect(createArgs.data.mustChangePassword).toBe(false);
    expect(typeof createArgs.data.passwordHash).toBe('string');
    expect(createArgs.data.passwordHash).not.toBe(VALID_DTO.password);
    expect(createArgs.data.passwordHash).toMatch(/^\$argon2id\$/);

    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: 'user-new', roleId: CONFIGURED_ROLE.id } });

    // Exactly {id, email, name} — no accessToken/refreshToken/sessionId.
    expect(result).toEqual({ id: 'user-new', email: VALID_DTO.email, name: VALID_DTO.name });
    expect(Object.keys(result).sort()).toEqual(['email', 'id', 'name']);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate email as ConflictException, not the raw Prisma unique-constraint error', async () => {
    prisma.role.findUnique.mockResolvedValue(CONFIGURED_ROLE);
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

describe('AuthService.isSelfRegistrationOpen (D41 follow-up: public status read for LoginPage)', () => {
  let tx: MockTx;
  let prisma: MockPrisma;
  let jwtService: MockJwtService;
  let service: AuthService;

  beforeEach(() => {
    tx = { user: { create: jest.fn() }, userRole: { create: jest.fn() } };
    prisma = createMockPrisma(tx);
    jwtService = { signAsync: jest.fn() };
  });

  function buildService(settings: MockSettings): AuthService {
    return new AuthService(prisma as never, jwtService as never, settings as never);
  }

  it('reports true when the setting is on', async () => {
    service = buildService(createMockSettings({ allowSelfRegistration: true }));
    await expect(service.isSelfRegistrationOpen()).resolves.toBe(true);
  });

  it('reports false when the setting is off', async () => {
    service = buildService(createMockSettings({ allowSelfRegistration: false }));
    await expect(service.isSelfRegistrationOpen()).resolves.toBe(false);
  });
});
