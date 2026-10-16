import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
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
  SELF_REGISTRATION_ROLE_CODE_KEY,
  TOKEN_LIFETIMES_KEY,
  TokenLifetimes,
} from '../settings/settings.types';
import { RegisterDto } from './dto/register.dto';
import { SetupCreateAdminDto } from './dto/setup.dto';
import { getJwtSecret } from './jwt.constants';
import { assertPasswordMeetsPolicy } from './password-policy.util';

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
/** See `refresh()`: a just-rotated token presented again inside this window is a race, not theft. */
export const REFRESH_REUSE_GRACE_MS = 10_000;

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
  private async issueSession(userId: string, meta: RequestMeta, familyId?: string): Promise<IssuedTokens> {
    const lifetimes = await this.getTokenLifetimes();

    const rawRefreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashRefreshToken(rawRefreshToken);
    const now = Date.now();
    const refreshTokenExpiresAt = new Date(now + lifetimes.refreshTokenDays * MS_PER_DAY);

    const session = await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash,
        // A rotation continues its login's family; a fresh login starts a new one (DB default).
        ...(familyId ? { familyId } : {}),
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

  /** Revokes the still-active sessions of ONE login chain (theft-detection response); the user's other devices keep theirs. */
  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { familyId, revokedAt: null },
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
      // Two tabs/requests of the SAME browser can legitimately present the same
      // cookie within moments of each other (page restore with several tabs, a lost
      // response retried): the loser sees the winner's rotation as "reuse". Inside a
      // short window that is a race, not theft, so reject this one request WITHOUT
      // revoking anything (a real replay later revokes that login's family only).
      if (Date.now() - session.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
        throw new UnauthorizedException('Refresh token was just rotated; retry with the current cookie');
      }
      this.logger.warn(
        `Refresh token reuse detected for session ${session.id} (user ${session.userId}, family ${session.familyId}); revoking that login only. ` +
          `Original login: ip=${session.ipAddress ?? '?'} ua="${session.userAgent ?? '?'}"; replay from: ip=${meta.ipAddress ?? '?'} ua="${meta.userAgent ?? '?'}".`,
      );
      await this.revokeFamily(session.familyId);
      throw new UnauthorizedException('Refresh token reuse detected; this login has been revoked');
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
    return this.issueSession(session.userId, meta, session.familyId);
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // The logout audit row is written by AuthController (§8.2, no diff).
  }

  /**
   * Voluntary password change for a logged-in user. The current password must be
   * re-entered (a stolen access token alone cannot change it); a wrong one counts
   * toward the same lockout as a wrong login. On success every OTHER session of the
   * user is revoked (the current one stays), so a leaked password/session ends here.
   * Returns how many other sessions were signed out.
   */
  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<{ otherSessionsRevoked: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const policy = await this.getPasswordPolicy();

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        { statusCode: HttpStatus.LOCKED, message: 'Account is temporarily locked due to too many failed attempts. Try again later.' },
        HttpStatus.LOCKED,
      );
    }

    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      const lockedOut = failedLoginAttempts >= policy.maxFailedAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lockedOut ? 0 : failedLoginAttempts,
          lockedUntil: lockedOut ? new Date(Date.now() + policy.lockoutMinutes * MS_PER_MINUTE) : user.lockedUntil,
        },
      });
      throw new BadRequestException('Current password is incorrect');
    }

    if (newPassword === currentPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }
    assertPasswordMeetsPolicy(newPassword, policy);

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
    });

    const revoked = await this.prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: sessionId } },
      data: { revokedAt: new Date() },
    });
    return { otherSessionsRevoked: revoked.count };
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
   * D41/D91/D92: self-registration. Checks the registrant's OWN input
   * (duplicate email) BEFORE any server-config gate (disabled? role
   * configured?) — D92 fix: the original order checked config first, so a
   * registrant retrying an already-taken email while the admin hadn't
   * configured a role yet got a misleading "no role configured" 403
   * instead of "this email is taken," masking the real problem. 403s when
   * `users.allow_self_registration` is off (the admin-editable Users
   * setting — see settings.controller.ts's `/settings/registration`);
   * otherwise validates the password against the live `auth.password_policy`
   * (same rule as any other password, D23), creates the user, and assigns
   * EXACTLY the role configured in `users.self_registration_role_code` —
   * never a choice the registrant makes, and never a hardcoded role, since
   * papp is a general back-office platform (CLAUDE.md), not Library-specific
   * (D91 removed the old hardcoded "reader"). 403s with a distinct message
   * when that setting is unset or points at a role that no longer exists,
   * so an admin sees a clear "not configured" error rather than a generic
   * 500. Deliberately does NOT auto-login (no session/tokens issued here,
   * per BUILD_PLAN.md Phase 5: "does not auto-login (201, no tokens)") —
   * the new user logs in separately afterward like anyone else.
   */
  async register(dto: RegisterDto): Promise<RegisteredUser> {
    // D92: checked FIRST and independently of every config gate below — an
    // existing account is true regardless of whether self-registration is
    // even on right now. Still re-checked at the actual INSERT (the
    // catch-block below) for the TOCTOU window between this read and the
    // transaction's write; this upfront check only makes the COMMON case
    // (an existing user, not a race) fail with the right message instead
    // of masking it behind a config error.
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const allowSelfRegistration = await this.settings.get<boolean>(ALLOW_SELF_REGISTRATION_KEY);
    if (!allowSelfRegistration) {
      throw new ForbiddenException('Self-registration is currently disabled');
    }

    const roleCode = await this.settings.get<string | null>(SELF_REGISTRATION_ROLE_CODE_KEY);
    if (!roleCode) {
      throw new ForbiddenException('Self-registration has no role configured — ask an admin to set one in Settings');
    }

    const policy = await this.getPasswordPolicy();
    assertPasswordMeetsPolicy(dto.password, policy);

    const role = await this.prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) {
      // The configured role code no longer exists (deleted after being set)
      // — an admin misconfiguration, not a user error, but still never a
      // 500: the registrant sees the same clear "ask an admin" message.
      throw new ForbiddenException('Self-registration has no role configured — ask an admin to set one in Settings');
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
        await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });
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
