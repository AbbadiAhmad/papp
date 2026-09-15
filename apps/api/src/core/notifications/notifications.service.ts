import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Notification, NotificationTargetType } from '@prisma/client';
import { AuditLogWriter } from '../audit/audit-log.writer';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NOTIFICATION_CATEGORIES_KEY, NotificationCategoriesConfig } from '../settings/settings.types';
import { applyPlaceholders, renderMarkdownToSafeHtml } from './markdown.util';
import { NotificationEmailService } from './notification-email.service';

export interface SendNotificationInput {
  /** e.g. 'auth.password_reset', 'system.announcement'. */
  category: string;
  title: string;
  bodyMarkdown: string;
  targetType: NotificationTargetType;
  /** user_id or role_id; must be null/absent for 'all_users' (D21). */
  targetId?: string | null;
  /** null = system-generated (ARCHITECTURE.md §12.1). */
  sentBy?: string | null;
}

export interface SendResult {
  notification: Notification;
  recipientCount: number;
  emailedCount: number;
}

/** One inbox entry, rendered for display (§12.1 — never stored this way). */
export interface InboxItem {
  notificationId: string;
  category: string;
  title: string;
  bodyMarkdown: string;
  /** Sanitized render of bodyMarkdown, {{name}} already substituted. */
  bodyHtml: string;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * The Notification Center (ARCHITECTURE.md §12, D20/D21/D22): one send()
 * fans out to both channels — an in-app notification_recipients row per
 * targeted user (always), plus an outbound email per recipient when the
 * category has email enabled in the admin-tunable `notifications.categories`
 * setting (a category absent from that map is in-app only).
 *
 * Targeting (D21): 'user' | 'role' | 'all_users' — platform accounts only,
 * never an external address. ROLE targets resolve to the role's CURRENT
 * holders at the moment of the send (§12.2): the user_roles join runs fresh
 * inside send(), so a membership change is reflected by the very next send.
 * Role and all_users targets include active users only (a notice to a
 * deactivated account is dead mail); a 'user' target is honored even for an
 * inactive user, since a caller naming one specific account explicitly
 * (e.g. the password-reset flow) knows who it means.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly email: NotificationEmailService,
    // @Optional for lightweight unit fixtures only — in the real app the
    // @Global AuditModule always provides it (same rule as SettingsService).
    @Optional() private readonly auditLogWriter?: AuditLogWriter,
  ) {}

  async send(input: SendNotificationInput): Promise<SendResult> {
    this.assertTargetShape(input);
    const recipients = await this.resolveRecipients(input);

    // The send event + its full in-app fan-out commit atomically: a
    // notification row with half its recipients would be a lie in both
    // the inbox and the audit trail.
    const notification = await this.prisma.$transaction(async (tx) => {
      const created = await tx.notification.create({
        data: {
          category: input.category,
          title: input.title,
          bodyMarkdown: input.bodyMarkdown,
          sentBy: input.sentBy ?? null,
          targetType: input.targetType,
          targetId: input.targetType === 'all_users' ? null : input.targetId,
        },
      });
      if (recipients.length > 0) {
        await tx.notificationRecipient.createMany({
          data: recipients.map((r) => ({ notificationId: created.id, userId: r.id })),
        });
      }
      return created;
    });

    // Every send is audited. A person-composed send (sentBy set) reaches
    // this service through POST /notifications, whose @Audit decorator +
    // the global AuditInterceptor write the actor_type='user' row — writing
    // another here would double-log it. A SYSTEM-generated send (sentBy
    // null, e.g. the password-reset notice fired from inside a service) has
    // no HTTP handler of its own, so per the Phase 3 rule ("genuine
    // 'system' rows are written directly by the calling service, never
    // inferred by the interceptor") this service writes it directly.
    if (input.sentBy == null) {
      if (this.auditLogWriter) {
        await this.auditLogWriter.write({
          actorType: 'system',
          category: 'core.notifications',
          entityType: 'Notification',
          entityId: notification.id,
          action: 'create',
          newValue: {
            category: notification.category,
            title: notification.title,
            targetType: notification.targetType,
            targetId: notification.targetId,
            recipientCount: recipients.length,
          },
        });
      } else {
        this.logger.error(
          `System notification ${notification.id} was sent with NO AuditLogWriter wired — the send is ` +
            'UNAUDITED. This must never occur outside an isolated unit-test fixture.',
        );
      }
    }

    const emailedCount = (await this.isEmailEnabled(input.category))
      ? await this.emailRecipients(notification, recipients)
      : 0;

    return { notification, recipientCount: recipients.length, emailedCount };
  }

  /**
   * The caller's own inbox, newest first, plus the unread count. The
   * owner's display name is looked up here to drive {{name}} substitution
   * at render time (the JWT principal carries no name).
   */
  async getInbox(userId: string): Promise<{ unreadCount: number; notifications: InboxItem[] }> {
    const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notificationRecipient.findMany({
        where: { userId },
        include: { notification: true },
        orderBy: { notification: { createdAt: 'desc' } },
      }),
      this.prisma.notificationRecipient.count({ where: { userId, readAt: null } }),
    ]);

    const values = { name: owner?.name ?? '' };
    return {
      unreadCount,
      notifications: rows.map((row) => ({
        notificationId: row.notificationId,
        category: row.notification.category,
        title: applyPlaceholders(row.notification.title, values),
        bodyMarkdown: applyPlaceholders(row.notification.bodyMarkdown, values),
        // Rendered at display time, never stored pre-rendered (§12.1).
        bodyHtml: renderMarkdownToSafeHtml(applyPlaceholders(row.notification.bodyMarkdown, values)),
        createdAt: row.notification.createdAt,
        readAt: row.readAt,
      })),
    };
  }

  /**
   * Marks the CALLER's own recipient row read — ownership is the composite
   * key itself: a (notificationId, userId) row only exists if this user was
   * a recipient, so another user's notification 404s here rather than 403s
   * (no probing which notification ids exist).
   */
  async markRead(userId: string, notificationId: string): Promise<{ notificationId: string; readAt: Date }> {
    const row = await this.prisma.notificationRecipient.findUnique({
      where: { notificationId_userId: { notificationId, userId } },
    });
    if (!row) {
      throw new NotFoundException('Notification not found');
    }
    if (row.readAt) {
      return { notificationId, readAt: row.readAt }; // idempotent re-read
    }
    const updated = await this.prisma.notificationRecipient.update({
      where: { notificationId_userId: { notificationId, userId } },
      data: { readAt: new Date() },
    });
    return { notificationId, readAt: updated.readAt as Date };
  }

  // --- internals ------------------------------------------------------------

  private assertTargetShape(input: SendNotificationInput): void {
    if (input.targetType === 'all_users' && input.targetId) {
      throw new BadRequestException("targetId must be omitted when targetType is 'all_users'");
    }
    if (input.targetType !== 'all_users' && !input.targetId) {
      throw new BadRequestException(`targetId is required when targetType is '${input.targetType}'`);
    }
  }

  private async resolveRecipients(input: SendNotificationInput): Promise<Array<{ id: string; email: string; name: string }>> {
    const select = { id: true, email: true, name: true } as const;

    switch (input.targetType) {
      case 'user': {
        const user = await this.prisma.user.findUnique({ where: { id: input.targetId as string }, select });
        if (!user) {
          throw new NotFoundException('Target user not found');
        }
        return [user];
      }
      case 'role': {
        const role = await this.prisma.role.findUnique({ where: { id: input.targetId as string } });
        if (!role) {
          throw new NotFoundException('Target role not found');
        }
        // CURRENT holders, resolved right now (§12.2) — never a cached list.
        return this.prisma.user.findMany({
          where: { isActive: true, userRoles: { some: { roleId: role.id } } },
          select,
          orderBy: { createdAt: 'asc' },
        });
      }
      case 'all_users':
        return this.prisma.user.findMany({ where: { isActive: true }, select, orderBy: { createdAt: 'asc' } });
    }
  }

  private async isEmailEnabled(category: string): Promise<boolean> {
    const config = await this.settings.get<NotificationCategoriesConfig>(NOTIFICATION_CATEGORIES_KEY);
    return config[category]?.email === true;
  }

  /** Sequential per-recipient send; each success stamps that row's emailed_at. */
  private async emailRecipients(
    notification: Notification,
    recipients: Array<{ id: string; email: string; name: string }>,
  ): Promise<number> {
    let emailedCount = 0;
    for (const recipient of recipients) {
      const values = { name: recipient.name };
      const subject = applyPlaceholders(notification.title, values);
      const bodyMarkdown = applyPlaceholders(notification.bodyMarkdown, values);
      const delivered = await this.email.send({
        to: recipient.email,
        subject,
        text: bodyMarkdown,
        html: renderMarkdownToSafeHtml(bodyMarkdown),
      });
      if (!delivered) continue;
      emailedCount += 1;
      try {
        await this.prisma.notificationRecipient.update({
          where: { notificationId_userId: { notificationId: notification.id, userId: recipient.id } },
          data: { emailedAt: new Date() },
        });
      } catch (error) {
        this.logger.error(
          `Email to ${recipient.email} was sent but stamping emailed_at failed for notification ${notification.id}.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return emailedCount;
  }
}
