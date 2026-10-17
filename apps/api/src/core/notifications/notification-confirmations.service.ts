import { ConflictException, GoneException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditLogWriter } from '../audit/audit-log.writer';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NOTIFICATION_CONFIRMATION_KEY, NotificationConfirmationConfig } from '../settings/settings.types';
import { contentHash, generateConfirmationToken, hashConfirmationToken } from './confirmation.util';
import { applyPlaceholders, renderMarkdownToSafeHtml } from './markdown.util';

export interface ConfirmationPreview {
  title: string;
  bodyHtml: string;
  confirmationType: string;
  allowComment: boolean;
  recipientName: string;
  /** Set when this recipient already confirmed — the page then shows the receipt instead of the form. */
  confirmedAt: Date | null;
  expired: boolean;
}

export interface ConfirmationReceipt {
  confirmedAt: Date;
  confirmationType: string;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

const DAY_MS = 86_400_000;

/**
 * Receipt / acceptance confirmation for notifications (D119). Send time issues
 * one personal token per emailed recipient (only its SHA-256 is stored); the
 * public confirm endpoints resolve the token back to ONE (notification, user)
 * pair and write an append-only evidence row: who, when, IP, browser, the exact
 * text shown (+ SHA-256) and the confirmer's comment.
 */
@Injectable()
export class NotificationConfirmationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    // @Optional for lightweight unit fixtures only, same rule as NotificationsService.
    @Optional() private readonly auditLogWriter?: AuditLogWriter,
  ) {}

  /** Issues (or re-issues) the recipient's token and returns the plain token for the email. */
  async issueToken(notificationId: string, userId: string): Promise<string> {
    const { linkTtlDays } = await this.settings.get<NotificationConfirmationConfig>(NOTIFICATION_CONFIRMATION_KEY);
    const token = generateConfirmationToken();
    await this.prisma.notificationRecipient.update({
      where: { notificationId_userId: { notificationId, userId } },
      data: {
        confirmationTokenHash: hashConfirmationToken(token),
        confirmationExpiresAt: new Date(Date.now() + linkTtlDays * DAY_MS),
      },
    });
    return token;
  }

  async preview(token: string): Promise<ConfirmationPreview> {
    const { recipient, user } = await this.resolve(token);
    const existing = await this.prisma.notificationConfirmation.findUnique({
      where: { notification_confirmations_once: { notificationId: recipient.notificationId, userId: recipient.userId } },
    });
    const { notification } = recipient;
    const values = { name: user.name };
    return {
      title: applyPlaceholders(notification.title, values),
      bodyHtml: renderMarkdownToSafeHtml(applyPlaceholders(notification.bodyMarkdown, values)),
      confirmationType: notification.confirmationType ?? 'receipt',
      allowComment: notification.confirmationAllowComment,
      recipientName: user.name,
      confirmedAt: existing?.confirmedAt ?? null,
      expired: !existing && this.isExpired(recipient.confirmationExpiresAt),
    };
  }

  async confirm(token: string, comment: string | undefined, meta: RequestMeta): Promise<ConfirmationReceipt> {
    const { recipient, user } = await this.resolve(token);
    const { notification } = recipient;

    const already = await this.prisma.notificationConfirmation.findUnique({
      where: { notification_confirmations_once: { notificationId: recipient.notificationId, userId: recipient.userId } },
    });
    if (already) {
      throw new ConflictException('This notification was already confirmed');
    }
    if (this.isExpired(recipient.confirmationExpiresAt)) {
      throw new GoneException('This confirmation link has expired');
    }

    // Evidence keeps the text exactly as this person was shown it (their name substituted).
    const values = { name: user.name };
    const title = applyPlaceholders(notification.title, values);
    const bodyMarkdown = applyPlaceholders(notification.bodyMarkdown, values);
    const trimmed = notification.confirmationAllowComment ? comment?.trim() || null : null;
    const confirmationType = notification.confirmationType ?? 'receipt';

    let row;
    try {
      row = await this.prisma.notificationConfirmation.create({
        data: {
          notificationId: notification.id,
          userId: user.id,
          confirmationType,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          notificationTitle: title,
          notificationBodyMarkdown: bodyMarkdown,
          contentSha256: contentHash(title, bodyMarkdown),
          confirmerName: user.name,
          confirmerEmail: user.email,
          comment: trimmed,
        },
      });
    } catch (error) {
      // A concurrent double-click loses the unique race: report it as "already confirmed".
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('This notification was already confirmed');
      }
      throw error;
    }

    // Confirming implies having read it.
    if (!recipient.readAt) {
      await this.prisma.notificationRecipient.update({
        where: { notificationId_userId: { notificationId: recipient.notificationId, userId: recipient.userId } },
        data: { readAt: row.confirmedAt },
      });
    }

    // The link proves mailbox control, not a login: audited as 'anonymous' with the user in the payload.
    await this.auditLogWriter?.write({
      actorType: 'anonymous',
      category: 'core.notifications',
      entityType: 'NotificationConfirmation',
      entityId: row.id,
      action: 'confirm',
      newValue: {
        notificationId: notification.id,
        userId: user.id,
        confirmationType,
        contentSha256: row.contentSha256,
        hasComment: trimmed !== null,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { confirmedAt: row.confirmedAt, confirmationType };
  }

  /** Admin evidence view: every confirmation for one notification, plus who has not confirmed yet. */
  async listForNotification(notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { recipients: { select: { userId: true, emailedAt: true } } },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    const confirmations = await this.prisma.notificationConfirmation.findMany({
      where: { notificationId },
      orderBy: { confirmedAt: 'asc' },
    });
    const confirmedIds = new Set(confirmations.map((c) => c.userId));
    const pendingUserIds = notification.recipients.map((r) => r.userId).filter((id) => !confirmedIds.has(id));
    const pendingUsers = pendingUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: pendingUserIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    return {
      notification: {
        id: notification.id,
        title: notification.title,
        createdAt: notification.createdAt,
        requiresConfirmation: notification.requiresConfirmation,
        confirmationType: notification.confirmationType,
      },
      confirmations,
      pending: pendingUsers,
    };
  }

  /** Notifications that asked for confirmation, newest first, with counts (admin list). */
  async listRequests() {
    const rows = await this.prisma.notification.findMany({
      where: { requiresConfirmation: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { recipients: true } } },
    });
    const counts = await this.prisma.notificationConfirmation.groupBy({
      by: ['notificationId'],
      where: { notificationId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.notificationId, c._count._all]));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      confirmationType: r.confirmationType,
      createdAt: r.createdAt,
      recipientCount: r._count.recipients,
      confirmedCount: byId.get(r.id) ?? 0,
    }));
  }

  /**
   * For later features (e.g. "accept the policy to activate the account"):
   * has this user ever confirmed a notification of this type?
   */
  async hasConfirmed(userId: string, confirmationType: string): Promise<boolean> {
    const count = await this.prisma.notificationConfirmation.count({ where: { userId, confirmationType } });
    return count > 0;
  }

  // --- internals ------------------------------------------------------------

  private isExpired(expiresAt: Date | null): boolean {
    return expiresAt !== null && expiresAt.getTime() < Date.now();
  }

  /** Token -> recipient row + user. Unknown token is a plain 404 (no hint whether one ever existed). */
  private async resolve(token: string) {
    const recipient = await this.prisma.notificationRecipient.findFirst({
      where: { confirmationTokenHash: hashConfirmationToken(token) },
      include: { notification: true },
    });
    if (!recipient || !recipient.notification.requiresConfirmation) {
      throw new NotFoundException('Confirmation link not found');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: recipient.userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException('Confirmation link not found');
    return { recipient, user };
  }
}
