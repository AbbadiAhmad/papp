import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PASSWORD_POLICY_KEY, PasswordPolicy, TOKEN_LIFETIMES_KEY, TokenLifetimes } from '../settings/settings.types';
import { getJwtSecret } from './jwt.constants';
import { assertPasswordMeetsPolicy } from './password-policy.util';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
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

    return { accessToken, refreshToken: rawRefreshToken, refreshTokenExpiresAt };
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
}
