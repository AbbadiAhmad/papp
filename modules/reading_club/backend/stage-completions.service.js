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
var StageCompletionsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StageCompletionsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const memberships_service_1 = require("./memberships.service");
const notifications_sender_1 = require("./notifications-sender");
/**
 * "If the reader finishes the stage he gets a reward. The librarian marks
 * the reader finished the stage and got his reward and moves to next
 * stage." — `markComplete` is the one action that does both: it snapshots
 * the completion (reward `pending`) AND advances the membership to the
 * next stage immediately, in one transaction. Reward DELIVERY is tracked
 * independently (`confirmReward`) so a librarian can hand over the actual
 * present later — e.g. via the library_circulation scan-page hook, when the
 * reader is next physically present — without blocking their progression.
 */
let StageCompletionsService = StageCompletionsService_1 = class StageCompletionsService {
    memberships;
    notifications;
    logger = new common_1.Logger(StageCompletionsService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(memberships, notifications) {
        this.memberships = memberships;
        this.notifications = notifications;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('reading_club (stage completions) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async markComplete(studentId, markedBy) {
        const membership = await this.memberships.getMembershipOrThrow(studentId);
        const stage = await this.prisma.readingClubStage.findUnique({ where: { id: membership.currentStageId } });
        if (!stage)
            throw new common_1.NotFoundException('Current stage not found');
        const progress = await this.memberships.computeStageProgress(studentId, membership.stageStartedAt, membership.manualProgressAmount, stage);
        const nextStage = await this.prisma.readingClubStage.findFirst({
            where: { groupId: membership.groupId, stageOrder: { gt: stage.stageOrder } },
            orderBy: { stageOrder: 'asc' },
        });
        const [completion] = await this.prisma.$transaction([
            this.prisma.readingClubStageCompletion.create({
                data: {
                    studentId,
                    groupId: membership.groupId,
                    stageId: stage.id,
                    targetAmountAtCompletion: stage.targetAmount,
                    progressAmountAtCompletion: progress.progressAmount,
                    markedBy,
                    rewardStatus: 'pending',
                },
            }),
            this.prisma.readingClubMembership.update({
                where: { studentId },
                data: { currentStageId: nextStage?.id ?? null, stageStartedAt: new Date(), manualProgressAmount: 0 },
            }),
        ]);
        const student = await this.prisma.libraryStudent.findUnique({ where: { id: studentId } });
        if (student) {
            const rewardNote = stage.rewardDescription ? ` المكافأة: ${stage.rewardDescription}.` : '';
            await this.notifyReader(student.userId, 'reading_club.stage_completed', 'إنجاز مرحلة في نادي القراءة', `أحسنت! لقد أنهيت مرحلة "${stage.name}".${rewardNote}`);
        }
        return completion;
    }
    /** Confirms the physical reward was handed over — independent of, and possibly later than, `markComplete` itself. Callable from this module's own reader page OR from library_circulation's scan-page hook. */
    async confirmReward(completionId, confirmedBy) {
        const completion = await this.prisma.readingClubStageCompletion.findUnique({ where: { id: completionId } });
        if (!completion)
            throw new common_1.NotFoundException('Stage completion not found');
        if (completion.rewardStatus === 'delivered') {
            throw new common_1.ConflictException('This reward has already been confirmed as delivered');
        }
        const updated = await this.prisma.readingClubStageCompletion.update({
            where: { id: completionId },
            data: { rewardStatus: 'delivered', rewardDeliveredAt: new Date(), rewardDeliveredBy: confirmedBy },
        });
        const student = await this.prisma.libraryStudent.findUnique({ where: { id: completion.studentId } });
        if (student) {
            await this.notifyReader(student.userId, 'reading_club.reward_delivered', 'استلام المكافأة', 'تم تسليمك مكافأة نادي القراءة. أحسنت!');
        }
        return updated;
    }
    /** Every pending (not-yet-delivered) reward for one reader — feeds library_circulation's scan-page hook (§ the confirm-on-scan requirement) and this module's own reader detail page. */
    async listPendingRewards(studentId) {
        const completions = await this.prisma.readingClubStageCompletion.findMany({
            where: { studentId, rewardStatus: 'pending' },
            orderBy: { completedAt: 'asc' },
        });
        if (completions.length === 0)
            return [];
        const stageIds = [...new Set(completions.map((c) => c.stageId))];
        const groupIds = [...new Set(completions.map((c) => c.groupId))];
        const [stages, groups] = await Promise.all([
            this.prisma.readingClubStage.findMany({ where: { id: { in: stageIds } } }),
            this.prisma.readingClubGroup.findMany({ where: { id: { in: groupIds } } }),
        ]);
        const stagesById = new Map(stages.map((s) => [s.id, s]));
        const groupsById = new Map(groups.map((g) => [g.id, g]));
        return completions.map((completion) => ({
            id: completion.id,
            groupName: groupsById.get(completion.groupId)?.name ?? null,
            stageName: stagesById.get(completion.stageId)?.name ?? null,
            rewardDescription: stagesById.get(completion.stageId)?.rewardDescription ?? null,
            completedAt: completion.completedAt,
        }));
    }
    async getPendingRewardsCount() {
        return this.prisma.readingClubStageCompletion.count({ where: { rewardStatus: 'pending' } });
    }
    /** Never lets a notification failure fail the underlying action (matches library_circulation.CirculationService's own `notifyStudent`, §23's UX addition, not a correctness requirement). */
    async notifyReader(userId, category, title, bodyMarkdown) {
        try {
            await this.notifications.send({ category, title, bodyMarkdown, targetType: 'user', targetId: userId, sentBy: null });
        }
        catch (error) {
            this.logger.error(`Failed to notify reader ${userId} ("${category}") — the underlying action itself succeeded.`, error);
        }
    }
};
exports.StageCompletionsService = StageCompletionsService;
exports.StageCompletionsService = StageCompletionsService = StageCompletionsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(notifications_sender_1.NOTIFICATIONS_SENDER)),
    __metadata("design:paramtypes", [memberships_service_1.MembershipsService, Object])
], StageCompletionsService);
