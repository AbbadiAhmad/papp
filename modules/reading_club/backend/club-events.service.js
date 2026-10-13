"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ClubEventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClubEventsService = exports.SUBSCRIBE_PERMISSION = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const club_events_1 = require("./club-events");
const notifications_sender_1 = require("./notifications-sender");
const permission_checker_1 = require("./permission-checker");
exports.SUBSCRIBE_PERMISSION = 'reading_club.notifications.subscribe';
/** Notification text is hardcoded Arabic like the module's other notices (root ASSUMPTIONS.md A15). */
const EVENT_TITLES = {
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
let ClubEventsService = ClubEventsService_1 = class ClubEventsService {
    notifications;
    permissions;
    logger = new common_1.Logger(ClubEventsService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(notifications, permissions) {
        this.notifications = notifications;
        this.permissions = permissions;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('reading_club (club events) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async getMySubscriptions(userId) {
        const rows = await this.prisma.readingClubEventSubscription.findMany({ where: { userId } });
        return { available: club_events_1.CLUB_EVENT_TYPES, subscribed: rows.map((r) => r.eventType) };
    }
    /** Replaces the caller's whole subscription set with `eventTypes`. */
    async setMySubscriptions(userId, eventTypes) {
        const unique = [...new Set(eventTypes)];
        const unknown = unique.filter((e) => !club_events_1.CLUB_EVENT_TYPES.includes(e));
        if (unknown.length)
            throw new common_1.BadRequestException(`Unknown club event type(s): ${unknown.join(', ')}`);
        await this.prisma.$transaction([
            this.prisma.readingClubEventSubscription.deleteMany({ where: { userId } }),
            ...(unique.length ? [this.prisma.readingClubEventSubscription.createMany({ data: unique.map((eventType) => ({ userId, eventType })) })] : []),
        ]);
        return { subscribed: unique };
    }
    async publish(event) {
        try {
            const subs = await this.prisma.readingClubEventSubscription.findMany({ where: { eventType: event.type } });
            if (subs.length === 0)
                return;
            let readerLine = '';
            if (event.studentId) {
                const student = await this.prisma.libraryStudent.findUnique({ where: { id: event.studentId } });
                const user = student ? await this.prisma.user.findUnique({ where: { id: student.userId }, select: { name: true } }) : null;
                readerLine = student ? `القارئ: ${user?.name ?? ''} (${student.code})` : '';
            }
            const body = [readerLine, event.details].filter(Boolean).join('\n\n') || EVENT_TITLES[event.type];
            for (const sub of subs) {
                const codes = await this.permissions.getEffectivePermissionCodes(sub.userId);
                if (!codes.has(exports.SUBSCRIBE_PERMISSION))
                    continue;
                try {
                    await this.notifications.send({
                        category: `reading_club.event.${event.type}`,
                        title: EVENT_TITLES[event.type],
                        bodyMarkdown: body,
                        targetType: 'user',
                        targetId: sub.userId,
                        sentBy: null,
                    });
                }
                catch (error) {
                    this.logger.error(`Failed to notify subscriber ${sub.userId} of "${event.type}".`, error);
                }
            }
        }
        catch (error) {
            this.logger.error(`Failed to publish club event "${event.type}" — the underlying action itself succeeded.`, error);
        }
    }
};
exports.ClubEventsService = ClubEventsService;
exports.ClubEventsService = ClubEventsService = ClubEventsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(notifications_sender_1.NOTIFICATIONS_SENDER)),
    __param(1, (0, common_1.Inject)(permission_checker_1.PERMISSION_CHECKER)),
    __metadata("design:paramtypes", [Object, Object])
], ClubEventsService);
