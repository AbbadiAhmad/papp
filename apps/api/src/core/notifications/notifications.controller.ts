import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { InboxItem, NotificationsService } from './notifications.service';

/**
 * GET /notifications/me and PATCH /notifications/:id/read are self-scoped
 * (they only ever touch the caller's own recipient rows) but are still
 * gated by `notifications.view` rather than left permission-check-free:
 * the code is granted to ALL FOUR base roles by default (migration 0006,
 * per ARCHITECTURE.md §12.4 — everyone must see notices meant for them),
 * which keeps the inbox universally reachable while staying data-driven —
 * an admin could still revoke it from a custom role, which a hardcoded
 * "no check" could never express.
 */
const fetchOwnRecipientRow = (prisma: PrismaService, req: Request) => {
  const user = (req as Request & { user?: AuthenticatedUser }).user;
  if (!user) return Promise.resolve(null);
  return prisma.notificationRecipient.findUnique({
    where: { notificationId_userId: { notificationId: req.params.id as string, userId: user.userId } },
  });
};

// Phase 5 global-guard switch: JwtAuthGuard/PermissionGuard are now global
// (app.module.ts) — only MustChangePasswordGuard stays controller-scoped.
@Controller('notifications')
@UseGuards(MustChangePasswordGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @RequirePermission('notifications.send')
  @Audit({ category: 'core.notifications', entityType: 'Notification', action: 'create' })
  async send(
    @Body() dto: SendNotificationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ id: string; recipientCount: number; emailedCount: number }> {
    const result = await this.notificationsService.send({
      category: dto.category,
      title: dto.title,
      bodyMarkdown: dto.bodyMarkdown,
      targetType: dto.targetType,
      targetId: dto.targetId ?? null,
      sentBy: user.userId, // a person composed this send — never null here
    });
    // `id` at the top level is what AuditInterceptor's entityId fallback
    // reads for the create row.
    return { id: result.notification.id, recipientCount: result.recipientCount, emailedCount: result.emailedCount };
  }

  @Get('me')
  @RequirePermission('notifications.view')
  async getMyInbox(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ unreadCount: number; notifications: InboxItem[] }> {
    return this.notificationsService.getInbox(user.userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('notifications.view')
  @Audit({
    category: 'core.notifications',
    entityType: 'NotificationRecipient',
    action: 'update',
    fetchState: fetchOwnRecipientRow,
  })
  async markRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ notificationId: string; readAt: Date }> {
    return this.notificationsService.markRead(user.userId, id);
  }
}
