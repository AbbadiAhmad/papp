import { Module } from '@nestjs/common';
import { NotificationEmailService } from './notification-email.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * The Notification Center (ARCHITECTURE.md §12, D20) — a CORE, mandatory
 * capability: registered directly in AppModule like Users/Roles/Audit,
 * never through the module-manifest install flow, never uninstallable.
 * Deliberately NOT @Global (unlike Prisma/Settings/Audit, which are
 * cross-cutting plumbing): the consumers that send notifications are few
 * and explicit — UsersModule imports this module for the password-flow
 * notices — and an explicit import per sender keeps "who can notify" visible.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEmailService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
