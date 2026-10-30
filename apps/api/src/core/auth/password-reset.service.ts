import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogWriter } from '../audit/audit-log.writer';
import { appPublicUrl, generateConfirmationToken, hashConfirmationToken } from '../notifications/confirmation.util';
import { renderMarkdownToSafeHtml } from '../notifications/markdown.util';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { SettingsService } from '../settings/settings.service';
import { PASSWORD_POLICY_KEY, PASSWORD_RESET_KEY, PasswordPolicy, PasswordResetConfig } from '../settings/settings.types';
import { assertPasswordMeetsPolicy } from './password-policy.util';

const MS_PER_MINUTE = 60_000;
/** A second request for the same account inside this window is silently ignored (mail-bomb guard). */
const MIN_SECONDS_BETWEEN_REQUESTS = 60;
const DEFAULT_LINK_TTL_MINUTES = 60;

/**
 * "Forgot password" by email (D122). The request endpoint never reveals whether an address has an
 * account (always the same answer). Links are single-use, expire (admin-tunable `auth.password_reset`),
 * and only their SHA-256 is stored. Completing a reset applies the live password policy, clears any
 * lockout and the must-change flag, revokes every session, and invalidates the account's other links.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly email: NotificationEmailService,
    private readonly audit: AuditLogWriter,
  ) {}

  private async linkTtlMinutes(): Promise<number> {
    try {
      const config = await this.settings.get<PasswordResetConfig>(PASSWORD_RESET_KEY);
      return config.linkTtlMinutes > 0 ? config.linkTtlMinutes : DEFAULT_LINK_TTL_MINUTES;
    } catch {
      return DEFAULT_LINK_TTL_MINUTES;
    }
  }

  /** Always resolves with no information about the account; sends the email only for an active account. */
  async request(emailAddress: string, ipAddress: string | null): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: emailAddress.trim(), mode: 'insensitive' }, isActive: true },
      select: { id: true, email: true, name: true },
    });
    if (!user) return;

    const base = appPublicUrl();
    if (!base) {
      this.logger.error('Password reset requested but APP_PUBLIC_URL is not set — no link can be built, nothing was sent.');
      return;
    }
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - MIN_SECONDS_BETWEEN_REQUESTS * 1000) } },
      select: { id: true },
    });
    if (recent) return;

    const ttl = await this.linkTtlMinutes();
    const token = generateConfirmationToken();
    // Older unused links stop working: only the newest email is valid.
    await this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashConfirmationToken(token), expiresAt: new Date(Date.now() + ttl * MS_PER_MINUTE), requestedIp: ipAddress },
    });

    const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
    const body =
      `مرحباً ${user.name}،\n\nطلبتَ إعادة تعيين كلمة المرور. افتح الرابط التالي (صالح ${ttl} دقيقة، ويعمل مرة واحدة):\n\n[${link}](${link})\n\n` +
      `إن لم تطلب ذلك فتجاهل هذه الرسالة.\n\n---\n\nHello ${user.name},\n\nYou asked to reset your password. Open this link (valid for ${ttl} minutes, one use):\n\n[${link}](${link})\n\n` +
      'If you did not ask for this, ignore this email.';
    await this.email.send({
      to: user.email,
      subject: 'إعادة تعيين كلمة المرور / Password reset',
      text: body,
      html: renderMarkdownToSafeHtml(body),
    });
    await this.audit.write({
      actorType: 'anonymous',
      category: 'core.auth',
      entityType: 'User',
      entityId: user.id,
      action: 'password_reset_requested',
      ipAddress,
    });
  }

  async complete(token: string, newPassword: string, ipAddress: string | null): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashConfirmationToken(token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.isActive) {
      throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
    }
    const policy = await this.settings.get<PasswordPolicy>(PASSWORD_POLICY_KEY);
    assertPasswordMeetsPolicy(newPassword, policy);

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
      // Whoever knew the old password (or had a session) is signed out everywhere.
      this.prisma.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    await this.audit.write({
      actorType: 'anonymous',
      category: 'core.auth',
      entityType: 'User',
      entityId: user.id,
      action: 'password_reset',
      ipAddress,
    });
  }
}
