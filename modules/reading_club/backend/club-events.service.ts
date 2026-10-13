import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CLUB_EVENT_TYPES, ClubEvent, ClubEventPublisher, ClubEventType } from './club-events';
import { NOTIFICATIONS_SENDER, NotificationsSender } from './notifications-sender';
import { PERMISSION_CHECKER, PermissionChecker } from './permission-checker';

export const SUBSCRIBE_PERMISSION = 'reading_club.notifications.subscribe';

/** Notification text is hardcoded Arabic like the module's other notices (root ASSUMPTIONS.md A15). */
const EVENT_TITLES: Record<ClubEventType, string> = {
  reader_added: 'نادي القراءة: إضافة قارئ',
  reader_removed: 'نادي القراءة: إزالة قارئ',
  reader_moved: 'نادي القراءة: نقل قارئ',
  stage_completed: 'نادي القراءة: إنهاء مرحلة',
  reward_given: 'نادي القراءة: تسليم مكافأة',
  group_created: 'نادي القراءة: إنشاء مجموعة',
  group_updated: 'نادي القراءة: تعديل مجموعة',
  group_deleted: 'نادي القراءة: حذف مجموعة',
  stage_created: 'نادي القراءة: إنشاء مرحلة',
  stage_updated: 'نادي القراءة: تعديل مرحلة',
  stage_deleted: 'نادي القراءة: حذف مرحلة',
  episode_started: 'نادي القراءة: بدء موسم جديد',
  episode_deleted: 'نادي القراءة: حذف موسم',
};

/**
 * Per-user subscriptions to club events (READING_CLUB-D20) plus the
 * publisher that fans an event out to the current subscribers through the
 * core Notification Center. A subscriber who has since LOST
 * `reading_club.notifications.subscribe` is skipped at publish time (their
 * row stays, so regaining the permission resumes it).
 */
@Injectable()
export class ClubEventsService implements ClubEventPublisher, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClubEventsService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @Inject(NOTIFICATIONS_SENDER) private readonly notifications: NotificationsSender,
    @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionChecker,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('reading_club (club events) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getMySubscriptions(userId: string): Promise<{ available: readonly ClubEventType[]; subscribed: string[] }> {
    const rows = await this.prisma.readingClubEventSubscription.findMany({ where: { userId } });
    return { available: CLUB_EVENT_TYPES, subscribed: rows.map((r) => r.eventType) };
  }

  /** Replaces the caller's whole subscription set with `eventTypes`. */
  async setMySubscriptions(userId: string, eventTypes: string[]): Promise<{ subscribed: string[] }> {
    const unique = [...new Set(eventTypes)];
    const unknown = unique.filter((e) => !(CLUB_EVENT_TYPES as readonly string[]).includes(e));
    if (unknown.length) throw new BadRequestException(`Unknown club event type(s): ${unknown.join(', ')}`);
    await this.prisma.$transaction([
      this.prisma.readingClubEventSubscription.deleteMany({ where: { userId } }),
      ...(unique.length ? [this.prisma.readingClubEventSubscription.createMany({ data: unique.map((eventType) => ({ userId, eventType })) })] : []),
    ]);
    return { subscribed: unique };
  }

  async publish(event: ClubEvent): Promise<void> {
    try {
      const subs = await this.prisma.readingClubEventSubscription.findMany({ where: { eventType: event.type } });
      if (subs.length === 0) return;

      let readerLine = '';
      if (event.studentId) {
        const student = await this.prisma.libraryStudent.findUnique({ where: { id: event.studentId } });
        const user = student ? await this.prisma.user.findUnique({ where: { id: student.userId }, select: { name: true } }) : null;
        readerLine = student ? `القارئ: ${user?.name ?? ''} (${student.code})` : '';
      }
      const body = [readerLine, event.details].filter(Boolean).join('\n\n') || EVENT_TITLES[event.type];

      for (const sub of subs) {
        const codes = await this.permissions.getEffectivePermissionCodes(sub.userId);
        if (!codes.has(SUBSCRIBE_PERMISSION)) continue;
        try {
          await this.notifications.send({
            category: `reading_club.event.${event.type}`,
            title: EVENT_TITLES[event.type],
            bodyMarkdown: body,
            targetType: 'user',
            targetId: sub.userId,
            sentBy: null,
          });
        } catch (error) {
          this.logger.error(`Failed to notify subscriber ${sub.userId} of "${event.type}".`, error);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to publish club event "${event.type}" — the underlying action itself succeeded.`, error);
    }
  }
}
