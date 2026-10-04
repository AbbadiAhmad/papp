import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  ALLOW_SELF_REGISTRATION_KEY,
  PASSWORD_POLICY_KEY,
  PasswordPolicy,
  TOKEN_LIFETIMES_KEY,
  TokenLifetimes,
} from '../settings/settings.types';
import { RegisterDto } from './dto/register.dto';
import { SetupCreateAdminDto } from './dto/setup.dto';
import { getJwtSecret } from './jwt.constants';
import { assertPasswordMeetsPolicy } from './password-policy.util';

/** D9/D41: the role every self-registered account is auto-assigned. */
const SELF_REGISTRATION_ROLE_CODE = 'reader';
/** Root D60/A27: the role the very first account on a fresh install gets. */
const FIRST_ADMIN_ROLE_CODE = 'admin';
/**
 * Arbitrary fixed key for `pg_advisory_xact_lock` — see `setupCreateFirstAdmin`.
 * Any int8 works; this one has no other meaning.
 */
const SETUP_ADVISORY_LOCK_KEY = 8_411_960_027n;
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export interface RegisteredUser {
  id: string;
  email: string;
  name: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  /**
   * The authenticated user's id and the new session row's id (= the JWT
   * `sid` claim). Never sent to the client — AuthController consumes them
   * for the login audit row (ARCHITECTURE.md §8.2) and drops them.
   */
  userId: string;
  sessionId: string;
}

interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly settings: SettingsService,
  ) {}

  private getPasswordPolicy(): Promise<PasswordPolicy> {
    return this.settings.get<PasswordPolicy>(PASSWORD_POLICY_KEY);
  }

  private getTokenLifetimes(): Promise<TokenLifetimes> {
    return this.settings.get<TokenLifetimes>(TOKEN_LIFETIMES_KEY);
  }

  private hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  /**
   * Creates a brand new session row + access/refresh token pair for a user
   * who has already been authenticated (fresh login, or refresh rotation).
   */
  private async issueSession(userId: string, meta: RequestMeta): Promise<IssuedTokens> {
    const lifetimes = await this.getTokenLifetimes();

    const rawRefreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashRefreshToken(rawRefreshToken);
    const now = Date.now();
    const refreshTokenExpiresAt = new Date(now + lifetimes.refreshTokenDays * MS_PER_DAY);

    const session = await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash,
        expiresAt: refreshTokenExpiresAt,
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      },
    });

    const accessToken = await this.jwtService.signAsync(
      { sub: userId, sid: session.id },
      { secret: getJwtSecret(), expiresIn: `${lifetimes.accessTokenMinutes}m` },
    );

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt,
      userId,
      sessionId: session.id,
    };
  }

  /** Revokes every currently-active session for a user (theft-detection response). */
  private async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async login(email: string, password: string, meta: RequestMeta): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Generic message for "no such user" and "wrong password" alike — avoid
    // leaking which emails are registered.
    const invalidCredentials = () => new UnauthorizedException('Invalid email or password');

    if (!user || !user.isActive) {
      throw invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        {
          statusCode: HttpStatus.LOCKED,
          message: 'Account is temporarily locked due to too many failed login attempts. Try again later.',
        },
        HttpStatus.LOCKED,
      );
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    const policy = await this.getPasswordPolicy();

    if (!passwordValid) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      const lockedOut = failedLoginAttempts >= policy.maxFailedAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lockedOut ? 0 : failedLoginAttempts,
          lockedUntil: lockedOut ? new Date(Date.now() + policy.lockoutMinutes * MS_PER_MINUTE) : user.lockedUntil,
        },
      });
      throw invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // The login audit row is written by AuthController right after this
    // returns (ARCHITECTURE.md §8.2 — written directly by AuthModule, no
    // @Audit/interceptor involvement since there's no before/after diff).
    return this.issueSession(user.id, meta);
  }

  /**
   * Rotates a refresh token. Reuse of an already-rotated-away (or
   * logged-out) refresh token revokes every active session for that user —
   * the theft-detection behavior required by ARCHITECTURE.md §6.1 point 4.
   */
  async refresh(rawRefreshToken: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const refreshTokenHash = this.hashRefreshToken(rawRefreshToken);
    const session = await this.prisma.userSession.findUnique({ where: { refreshTokenHash } });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      this.logger.warn(`Refresh token reuse detected for session ${session.id} (user ${session.userId}); revoking all sessions.`);
      await this.revokeAllSessionsForUser(session.userId);
      throw new UnauthorizedException('Refresh token reuse detected; all sessions have been revoked');
    }

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const lifetimes = await this.getTokenLifetimes();

    if (now - session.lastActiveAt.getTime() > lifetimes.idleTimeoutMinutes * MS_PER_MINUTE) {
      await this.prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Session idle timeout exceeded');
    }

    if (now - session.issuedAt.getTime() > lifetimes.absoluteTimeoutDays * MS_PER_DAY) {
      await this.prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Session absolute timeout exceeded');
    }

    // Rotate: the old row is marked revoked (its refresh_token_hash is kept,
    // not cleared, so a later replay of the same raw token is recognized as
    // reuse above) and a brand new session row + token pair is issued.
    await this.prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issueSession(session.userId, meta);
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // The logout audit row is written by AuthController (§8.2, no diff).
  }

  async forcePasswordChange(userId: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const policy = await this.getPasswordPolicy();
    assertPasswordMeetsPolicy(newPassword, policy);

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
  }

  /**
   * D41: self-registration. 403s when `users.allow_self_registration` is
   * off (the admin-editable Users setting — see settings.controller.ts's
   * `/settings/registration`); otherwise validates the password against the
   * live `auth.password_policy` (same rule as any other password, D23),
   * creates the user, and assigns EXACTLY the `reader` role — never a choice
   * the registrant makes. Deliberately does NOT auto-login (no session/
   * tokens issued here, per BUILD_PLAN.md Phase 5: "does not auto-login (201,
   * no tokens)") — the new user logs in separately afterward like anyone else.
   */
  async register(dto: RegisterDto): Promise<RegisteredUser> {
    const allowSelfRegistration = await this.settings.get<boolean>(ALLOW_SELF_REGISTRATION_KEY);
    if (!allowSelfRegistration) {
      throw new ForbiddenException('Self-registration is currently disabled');
    }

    const policy = await this.getPasswordPolicy();
    assertPasswordMeetsPolicy(dto.password, policy);

    const readerRole = await this.prisma.role.findUnique({ where: { code: SELF_REGISTRATION_ROLE_CODE } });
    if (!readerRole) {
      // Seeded by 0004_create_roles_permissions.sql — its absence means the
      // core migrations never ran, a deployment bug, not a user error.
      throw new InternalServerErrorException(`Base role "${SELF_REGISTRATION_ROLE_CODE}" is missing`);
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: dto.email,
            name: dto.name,
            passwordHash,
            // The registrant chose their own password — no forced change,
            // unlike an admin-created account with a temporary one.
            mustChangePassword: false,
          },
        });
        await tx.userRole.create({ data: { userId: created.id, roleId: readerRole.id } });
        return created;
      });
      return { id: user.id, email: user.email, name: user.name };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  /**
   * Root D60/A27: whether a fresh install still needs its first admin
   * account. Deliberately just `users` row count — not module_registry or
   * any other signal — matching MODULE_SPEC.md's own framing of "no
   * mechanism creates the first admin account" as purely about the `users`
   * table being empty. Safe to call with no session (see controller).
   */
  async isSetupNeeded(): Promise<boolean> {
    const userCount = await this.prisma.user.count();
    return userCount === 0;
  }

  /**
   * D41 follow-up: whether self-registration is currently open, for an
   * ANONYMOUS caller to decide whether LoginPage should show a "create an
   * account" link at all. Mirrors `isSetupNeeded()`'s role exactly — a pure
   * frontend-routing/UX convenience, never the actual gate. The real
   * enforcement stays server-side in `register()` above (reading the same
   * `users.allow_self_registration` setting independently), so this is safe
   * to call directly and never needs to be trusted. Deliberately a separate
   * `@Public()` read instead of reusing `GET /settings/registration`, which
   * is gated by `users.settings.view` and unreachable with no session.
   */
  async isSelfRegistrationOpen(): Promise<boolean> {
    return (await this.settings.get<boolean>(ALLOW_SELF_REGISTRATION_KEY)) ?? false;
  }

  /**
   * Root D60/A27 (UI-wizard option, confirmed over the env-seed/CLI/init-
   * container alternatives): creates the very first user on a fresh install
   * and assigns EXACTLY the `admin` role — never a choice the caller makes,
   * same pattern as `register()`'s hardcoded `reader`. Reachable with
   * `@Public()` (no session exists yet) and safe to call directly (curl,
   * repeated attempts, concurrent requests) without ever going through
   * `GET /auth/setup-status` first — that endpoint is a pure frontend-
   * routing convenience, never the actual gate.
   *
   * The emptiness check is re-done INSIDE the transaction (not just trusting
   * a prior `isSetupNeeded()` call), guarded by `pg_advisory_xact_lock`
   * (auto-released on commit/rollback) taken BEFORE the count. Postgres's
   * default `READ COMMITTED` isolation does NOT by itself make
   * "count, then insert if zero" atomic across two truly concurrent
   * transactions — both could read `count() === 0` before either commits,
   * both would then insert, and both would return 201 with an
   * `admin`-role account instead of the second failing with 409. There is
   * no unique constraint to fall back on here (unlike `register()`, where
   * the `email` unique index is what actually prevents a duplicate
   * regardless of isolation level) — "at most one row may ever exist" has
   * no natural column to key a unique index on. The advisory lock serializes
   * just this one critical section: only one transaction holds it at a
   * time, so its count-then-insert is effectively atomic, and every other
   * concurrent caller blocks until the first commits, then sees the real
   * post-insert count and 409s. Cost is negligible — this section runs at
   * most a handful of times ever, on a fresh install.
   */
  async setupCreateFirstAdmin(dto: SetupCreateAdminDto): Promise<RegisteredUser> {
    const policy = await this.getPasswordPolicy();
    assertPasswordMeetsPolicy(dto.password, policy);

    const adminRole = await this.prisma.role.findUnique({ where: { code: FIRST_ADMIN_ROLE_CODE } });
    if (!adminRole) {
      // Seeded by 0004_create_roles_permissions.sql — its absence means the
      // core migrations never ran, a deployment bug, not a user error.
      throw new InternalServerErrorException(`Base role "${FIRST_ADMIN_ROLE_CODE}" is missing`);
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY})`;
        const userCount = await tx.user.count();
        if (userCount > 0) {
          throw new ConflictException('Setup has already been completed');
        }
        const created = await tx.user.create({
          data: {
            email: dto.email,
            name: dto.name,
            passwordHash,
            // The operator chose their own password interactively — no
            // forced change, same reasoning as self-registration.
            mustChangePassword: false,
          },
        });
        await tx.userRole.create({ data: { userId: created.id, roleId: adminRole.id } });
        return created;
      });
      return { id: user.id, email: user.email, name: user.name };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }
}
