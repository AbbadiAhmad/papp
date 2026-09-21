import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AssignMembershipDto } from './dto/assign-membership.dto';
import { MoveStageDto } from './dto/move-stage.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';

const ACTIVE_BORROWING_RETURNED_STATUS = 'returned';

export interface StageProgress {
  targetType: 'books' | 'pages';
  targetAmount: number;
  progressAmount: number;
  isComplete: boolean;
}

/**
 * A reader's group/stage assignment and progress. "Progress" is computed
 * two different ways depending on the current stage's `targetType`
 * (DECISIONS.md has the full reasoning):
 *  - `books`: counted LIVE from `library_borrowings` (returned since
 *    `stageStartedAt`) — real data already owned by library_circulation,
 *    zero manual entry, always fresh (never cached/stored).
 *  - `pages`: no page-count data exists anywhere in the catalog, so this
 *    is the librarian's own manually-recorded running total
 *    (`manualProgressAmount`).
 *
 * Own dedicated `PrismaClient` (D57 pattern). Reads `library_students`/
 * `library_borrowings`/`users` directly through it — the same "a module
 * reads its `dependsOn` dependency's tables directly, coupled only through
 * the shared DB schema" pattern `library_circulation`'s own
 * `CirculationService` already established for `library_catalog`.
 */
@Injectable()
export class MembershipsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MembershipsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('reading_club (memberships) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Readers with (or without) a reading-club membership, filterable by
   * group/stage/free-text search (code or name) — "the librarian can search
   * a specific reader or see readers in a specific group or stage
   * (filters)". Free-text search matches the library student's `code` or
   * their linked `users.name`.
   */
  async listReaders(filter: { groupId?: string; stageId?: string; search?: string } = {}) {
    const memberships = await this.prisma.readingClubMembership.findMany({
      where: {
        groupId: filter.groupId,
        currentStageId: filter.stageId,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const studentIds = memberships.map((m) => m.studentId);
    const students = await this.prisma.libraryStudent.findMany({ where: { id: { in: studentIds } } });
    const studentsById = new Map(students.map((s) => [s.id, s]));
    const userIds = students.map((s) => s.userId);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } } });
    const usersById = new Map(users.map((u) => [u.id, u]));

    const groupIds = [...new Set(memberships.map((m) => m.groupId))];
    const groups = await this.prisma.readingClubGroup.findMany({ where: { id: { in: groupIds } } });
    const groupsById = new Map(groups.map((g) => [g.id, g]));
    const stageIds = memberships.map((m) => m.currentStageId).filter((id): id is string => id !== null);
    const stages = await this.prisma.readingClubStage.findMany({ where: { id: { in: stageIds } } });
    const stagesById = new Map(stages.map((s) => [s.id, s]));

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const student = studentsById.get(membership.studentId);
        const user = student ? usersById.get(student.userId) : undefined;
        const stage = membership.currentStageId ? stagesById.get(membership.currentStageId) : undefined;
        const progress = stage ? await this.computeStageProgress(membership.studentId, membership.stageStartedAt, membership.manualProgressAmount, stage) : null;
        return {
          studentId: membership.studentId,
          studentCode: student?.code ?? null,
          studentName: user?.name ?? null,
          groupId: membership.groupId,
          groupName: groupsById.get(membership.groupId)?.name ?? null,
          currentStageId: membership.currentStageId,
          stageName: stage?.name ?? null,
          stageOrder: stage?.stageOrder ?? null,
          progress,
        };
      }),
    );

    if (!filter.search?.trim()) return rows;
    const needle = filter.search.trim().toLowerCase();
    return rows.filter((row) => row.studentCode?.toLowerCase().includes(needle) || row.studentName?.toLowerCase().includes(needle));
  }

  async getReaderDetail(studentId: string) {
    const student = await this.prisma.libraryStudent.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Reader (library student) not found');
    const user = await this.prisma.user.findUnique({ where: { id: student.userId } });
    const membership = await this.prisma.readingClubMembership.findUnique({ where: { studentId } });

    let group = null;
    let stage = null;
    let progress: StageProgress | null = null;
    if (membership) {
      group = await this.prisma.readingClubGroup.findUnique({ where: { id: membership.groupId } });
      if (membership.currentStageId) {
        stage = await this.prisma.readingClubStage.findUnique({ where: { id: membership.currentStageId } });
        if (stage) {
          progress = await this.computeStageProgress(studentId, membership.stageStartedAt, membership.manualProgressAmount, stage);
        }
      }
    }

    const completions = await this.prisma.readingClubStageCompletion.findMany({
      where: { studentId },
      orderBy: { completedAt: 'desc' },
    });

    return {
      studentId: student.id,
      studentCode: student.code,
      studentName: user?.name ?? null,
      className: student.className,
      membership,
      group,
      stage,
      progress,
      completions,
    };
  }

  /** Assigns a reader to a group (first assignment, or moving them to a different group). */
  async assign(dto: AssignMembershipDto, assignedBy: string) {
    const group = await this.prisma.readingClubGroup.findUnique({ where: { id: dto.groupId } });
    if (!group) throw new NotFoundException('Group not found');

    let stageId = dto.stageId ?? null;
    if (stageId) {
      const stage = await this.prisma.readingClubStage.findUnique({ where: { id: stageId } });
      if (!stage || stage.groupId !== dto.groupId) {
        throw new BadRequestException('The given stage does not belong to the target group');
      }
    } else {
      const firstStage = await this.prisma.readingClubStage.findFirst({ where: { groupId: dto.groupId }, orderBy: { stageOrder: 'asc' } });
      stageId = firstStage?.id ?? null;
    }

    return this.prisma.readingClubMembership.upsert({
      where: { studentId: dto.studentId },
      create: {
        studentId: dto.studentId,
        groupId: dto.groupId,
        currentStageId: stageId,
        stageStartedAt: new Date(),
        manualProgressAmount: 0,
        assignedBy,
      },
      update: {
        groupId: dto.groupId,
        currentStageId: stageId,
        stageStartedAt: new Date(),
        manualProgressAmount: 0,
        assignedBy,
      },
    });
  }

  /** Manually moves a reader to a different stage WITHIN their current group — an administrative override, not the normal "mark complete" reward flow. */
  async moveStage(studentId: string, dto: MoveStageDto) {
    const membership = await this.getMembershipOrThrow(studentId);
    const stage = await this.prisma.readingClubStage.findUnique({ where: { id: dto.stageId } });
    if (!stage || stage.groupId !== membership.groupId) {
      throw new BadRequestException('The given stage does not belong to this reader\'s current group');
    }
    return this.prisma.readingClubMembership.update({
      where: { studentId },
      data: { currentStageId: stage.id, stageStartedAt: new Date(), manualProgressAmount: 0 },
    });
  }

  /** Records the librarian's manually-tracked running progress amount — the only progress source for a `pages`-type stage (no page-count data exists in the catalog to compute it automatically). */
  async updateManualProgress(studentId: string, dto: UpdateProgressDto) {
    await this.getMembershipOrThrow(studentId);
    return this.prisma.readingClubMembership.update({
      where: { studentId },
      data: { manualProgressAmount: dto.manualProgressAmount },
    });
  }

  async computeStageProgress(
    studentId: string,
    stageStartedAt: Date,
    manualProgressAmount: number,
    stage: { targetType: string; targetAmount: number },
  ): Promise<StageProgress> {
    const targetType = stage.targetType as 'books' | 'pages';
    const progressAmount =
      targetType === 'books'
        ? await this.prisma.libraryBorrowing.count({
            where: { studentId, status: ACTIVE_BORROWING_RETURNED_STATUS, returnedAt: { gte: stageStartedAt } },
          })
        : manualProgressAmount;
    return { targetType, targetAmount: stage.targetAmount, progressAmount, isComplete: progressAmount >= stage.targetAmount };
  }

  async getMembershipOrThrow(studentId: string) {
    const membership = await this.prisma.readingClubMembership.findUnique({ where: { studentId } });
    if (!membership) throw new NotFoundException('This reader has no reading-club membership yet');
    if (!membership.currentStageId) {
      throw new ConflictException('This reader has no current stage (their group has no stages, or they already finished the last one)');
    }
    return membership;
  }
}
