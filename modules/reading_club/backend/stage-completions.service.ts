import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EpisodesService } from './episodes.service';
import { MembershipsService } from './memberships.service';
import { NOTIFICATIONS_SENDER, NotificationsSender } from './notifications-sender';

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
@Injectable()
export class StageCompletionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StageCompletionsService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    private readonly memberships: MembershipsService,
    private readonly episodes: EpisodesService,
    @Inject(NOTIFICATIONS_SENDER) private readonly notifications: NotificationsSender,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('reading_club (stage completions) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async markComplete(studentId: string, markedBy: string) {
    const membership = await this.memberships.getMembershipOrThrow(studentId);
    await this.episodes.assertEpisodeIsCurrent(membership.episodeId);
    const stage = await this.prisma.readingClubStage.findUnique({ where: { id: membership.currentStageId! } });
    if (!stage) throw new NotFoundException('Current stage not found');

    const progress = await this.memberships.computeStageProgress(studentId, membership.stageStartedAt, membership.manualProgressAmount, stage);
    const nextStage = await this.prisma.readingClubStage.findFirst({
      where: { groupId: membership.groupId, stageOrder: { gt: stage.stageOrder } },
      orderBy: { stageOrder: 'asc' },
    });

    const [completion] = await this.prisma.$transaction([
      this.prisma.readingClubStageCompletion.create({
        data: {
          studentId,
          episodeId: membership.episodeId,
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
      await this.notifyReader(
        student.userId,
        'reading_club.stage_completed',
        'إنجاز مرحلة في نادي القراءة',
        `أحسنت! لقد أنهيت مرحلة "${stage.name}".${rewardNote}`,
      );
    }

    return completion;
  }

  /** Confirms the physical reward was handed over — independent of, and possibly later than, `markComplete` itself. Callable from this module's own reader page OR from library_circulation's scan-page hook. */
  async confirmReward(completionId: string, confirmedBy: string) {
    const completion = await this.prisma.readingClubStageCompletion.findUnique({ where: { id: completionId } });
    if (!completion) throw new NotFoundException('Stage completion not found');
    if (completion.rewardStatus === 'delivered') {
      throw new ConflictException('This reward has already been confirmed as delivered');
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
  async listPendingRewards(studentId: string) {
    const completions = await this.prisma.readingClubStageCompletion.findMany({
      where: { studentId, rewardStatus: 'pending' },
      orderBy: { completedAt: 'asc' },
    });
    if (completions.length === 0) return [];

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

  async getPendingRewardsCount(episodeId?: string): Promise<number> {
    const resolvedEpisodeId = episodeId ?? (await this.episodes.getCurrentEpisode()).id;
    return this.prisma.readingClubStageCompletion.count({ where: { episodeId: resolvedEpisodeId, rewardStatus: 'pending' } });
  }

  /**
   * Every pending reward ACROSS ALL readers, scoped to the given/current
   * episode — feeds the dashboard's pending-rewards list (item C). Realistic
   * scale for a school reading club, so no pagination (see manifest scope
   * cuts).
   */
  async listAllPendingRewards(episodeId?: string) {
    const resolvedEpisodeId = episodeId ?? (await this.episodes.getCurrentEpisode()).id;
    const completions = await this.prisma.readingClubStageCompletion.findMany({
      where: { episodeId: resolvedEpisodeId, rewardStatus: 'pending' },
      orderBy: { completedAt: 'asc' },
    });
    if (completions.length === 0) return [];

    const studentIds = [...new Set(completions.map((c) => c.studentId))];
    const stageIds = [...new Set(completions.map((c) => c.stageId))];
    const groupIds = [...new Set(completions.map((c) => c.groupId))];
    const [students, stages, groups] = await Promise.all([
      this.prisma.libraryStudent.findMany({ where: { id: { in: studentIds } } }),
      this.prisma.readingClubStage.findMany({ where: { id: { in: stageIds } } }),
      this.prisma.readingClubGroup.findMany({ where: { id: { in: groupIds } } }),
    ]);
    const studentsById = new Map(students.map((s) => [s.id, s]));
    const userIds = students.map((s) => s.userId);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } } });
    const usersById = new Map(users.map((u) => [u.id, u]));
    const stagesById = new Map(stages.map((s) => [s.id, s]));
    const groupsById = new Map(groups.map((g) => [g.id, g]));

    return completions.map((completion) => {
      const student = studentsById.get(completion.studentId);
      const user = student ? usersById.get(student.userId) : undefined;
      return {
        id: completion.id,
        studentId: completion.studentId,
        studentCode: student?.code ?? null,
        studentName: user?.name ?? null,
        groupName: groupsById.get(completion.groupId)?.name ?? null,
        stageName: stagesById.get(completion.stageId)?.name ?? null,
        rewardDescription: stagesById.get(completion.stageId)?.rewardDescription ?? null,
        completedAt: completion.completedAt,
      };
    });
  }

  /** Never lets a notification failure fail the underlying action (matches library_circulation.CirculationService's own `notifyStudent`, §23's UX addition, not a correctness requirement). */
  private async notifyReader(userId: string, category: string, title: string, bodyMarkdown: string): Promise<void> {
    try {
      await this.notifications.send({ category, title, bodyMarkdown, targetType: 'user', targetId: userId, sentBy: null });
    } catch (error) {
      this.logger.error(`Failed to notify reader ${userId} ("${category}") — the underlying action itself succeeded.`, error);
    }
  }
}
