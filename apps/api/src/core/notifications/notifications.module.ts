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
 *
 * `NotificationEmailService` is ALSO exported (docs/DECISIONS.md D64):
 * `NotificationsService`'s own targeting is platform-users-only by design
 * (D21), but a module can have a genuine need to send a transactional email
 * to an address that was never meant to be a platform account (the `survey`
 * module's admin-configured completion-notification addresses). Exporting
 * the transport directly — never the targeting-restricted service — keeps
 * D21 intact for the Notification Center feature itself while letting a
 * module reuse the one shared mail transport instead of standing up its own
 * SMTP config. `survey` imports this from `apps/api/dist/...` (built
 * output), exactly like it already imports `PublicThrottlerGuard` today
 * (D57's exception category — this is one more entry in it, not a new one).
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEmailService],
  exports: [NotificationsService, NotificationEmailService],
})
export class NotificationsModule {}
