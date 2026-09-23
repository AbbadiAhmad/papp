import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreateGroupDto } from './dto/create-group.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { EpisodesService } from './episodes.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Groups and their ordered stages — "the librarian defines the groups, the
 * stages, the amount in every stage, the present after every stage, the
 * stage order" (the module's own configuration surface, not a generic
 * `system_settings` JSON blob — a relational, orderable list of stages per
 * group doesn't fit that shape, see DECISIONS.md).
 *
 * Every group belongs to exactly one episode (READING_CLUB-D10) — reads
 * accept an optional `episodeId` (defaulting to the current episode) so a
 * past, closed episode's groups/stages remain browsable read-only; writes
 * are always rejected outside the current episode (READING_CLUB-D12).
 *
 * Own dedicated `PrismaClient` (D57 pattern, same as every other module).
 */
@Injectable()
export class GroupsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GroupsService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly episodes: EpisodesService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('reading_club (groups) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // --- Groups ------------------------------------------------------------

  /** `episodeId` omitted -> current episode's groups. */
  async listGroups(episodeId?: string) {
    const resolvedEpisodeId = episodeId ?? (await this.episodes.getCurrentEpisode()).id;
    return this.prisma.readingClubGroup.findMany({
      where: { episodeId: resolvedEpisodeId },
      orderBy: { createdAt: 'desc' },
      include: { stages: { orderBy: { stageOrder: 'asc' } } },
    });
  }

  async getGroup(id: string) {
    return this.getGroupOrThrow(id);
  }

  /** `dto.episodeId` omitted -> the current episode (READING_CLUB-D12). Always rejected if the resolved episode isn't current. */
  async createGroup(dto: CreateGroupDto, createdBy: string) {
    const episodeId = dto.episodeId ?? (await this.episodes.getCurrentEpisode()).id;
    await this.episodes.assertEpisodeIsCurrent(episodeId);
    return this.prisma.readingClubGroup.create({
      data: { episodeId, name: dto.name, description: dto.description, isActive: dto.isActive ?? true, createdBy },
      include: { stages: { orderBy: { stageOrder: 'asc' } } },
    });
  }

  async updateGroup(id: string, dto: UpdateGroupDto) {
    const group = await this.getGroupOrThrow(id);
    await this.episodes.assertEpisodeIsCurrent(group.episodeId);
    return this.prisma.readingClubGroup.update({
      where: { id },
      data: { name: dto.name, description: dto.description, isActive: dto.isActive },
      include: { stages: { orderBy: { stageOrder: 'asc' } } },
    });
  }

  /**
   * Deletion is now ALWAYS allowed, regardless of history (READING_CLUB-D16
   * — a deliberate user request, not a bug fix: the librarian wants to
   * reconfigure a season's groups/stages without losing that season's
   * already-earned reward/completion history). History rows survive via
   * `ON DELETE SET NULL` (migration 003) plus their own name snapshot
   * (`groupName`/`stageName`, taken at write time) — this method no longer
   * needs to touch history rows itself, Postgres does it automatically.
   * Still returns `affectedActiveReaderCount` so a caller (the frontend's
   * type-to-confirm dialog) can warn about the blast radius before calling
   * this — never a block, purely informational once this method actually
   * runs (the count reflects state just before deletion).
   */
  async removeGroup(id: string): Promise<{ affectedActiveReaderCount: number }> {
    const group = await this.getGroupOrThrow(id);
    await this.episodes.assertEpisodeIsCurrent(group.episodeId);
    const affectedActiveReaderCount = await this.prisma.readingClubMembership.count({ where: { groupId: id } });
    await this.prisma.$transaction([
      this.prisma.readingClubStage.deleteMany({ where: { groupId: id } }),
      this.prisma.readingClubGroup.delete({ where: { id } }),
    ]);
    return { affectedActiveReaderCount };
  }

  // --- Stages --------------------------------------------------------------

  async listStages(groupId: string) {
    await this.getGroupOrThrow(groupId);
    return this.prisma.readingClubStage.findMany({ where: { groupId }, orderBy: { stageOrder: 'asc' } });
  }

  async createStage(groupId: string, dto: CreateStageDto) {
    const group = await this.getGroupOrThrow(groupId);
    await this.episodes.assertEpisodeIsCurrent(group.episodeId);
    try {
      return await this.prisma.readingClubStage.create({
        data: {
          groupId,
          stageOrder: dto.stageOrder,
          name: dto.name,
          targetType: dto.targetType,
          targetAmount: dto.targetAmount,
          rewardDescription: dto.rewardDescription,
        },
      });
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  async updateStage(stageId: string, dto: UpdateStageDto) {
    const stage = await this.getStageOrThrow(stageId);
    const group = await this.getGroupOrThrow(stage.groupId);
    await this.episodes.assertEpisodeIsCurrent(group.episodeId);
    try {
      return await this.prisma.readingClubStage.update({
        where: { id: stageId },
        data: {
          stageOrder: dto.stageOrder,
          name: dto.name,
          targetType: dto.targetType,
          targetAmount: dto.targetAmount,
          rewardDescription: dto.rewardDescription,
        },
      });
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  /**
   * Deletion is now ALWAYS allowed, regardless of history — same
   * READING_CLUB-D16 decision as `removeGroup`. A reader currently on this
   * stage has their `currentStageId` set to NULL automatically (`ON DELETE
   * SET NULL`, migration 003); their membership's own `stageName` snapshot
   * (taken at assign/moveStage time) keeps their row displaying sensibly.
   * Returns `affectedActiveReaderCount` for the same caller-side warning
   * purpose as `removeGroup` — informational only, never a block.
   */
  async removeStage(stageId: string): Promise<{ affectedActiveReaderCount: number }> {
    const stage = await this.getStageOrThrow(stageId);
    const group = await this.getGroupOrThrow(stage.groupId);
    await this.episodes.assertEpisodeIsCurrent(group.episodeId);
    const affectedActiveReaderCount = await this.prisma.readingClubMembership.count({ where: { currentStageId: stageId } });
    await this.prisma.readingClubStage.delete({ where: { id: stageId } });
    return { affectedActiveReaderCount };
  }

  /** The stage immediately after `currentStage` in its own group's order, or `null` if `currentStage` is the last one. */
  async findNextStage(groupId: string, currentStageOrder: number) {
    return this.prisma.readingClubStage.findFirst({
      where: { groupId, stageOrder: { gt: currentStageOrder } },
      orderBy: { stageOrder: 'asc' },
    });
  }

  /** The group's own first stage (lowest order), used as the default when a membership is assigned with no explicit stage. */
  async findFirstStage(groupId: string) {
    return this.prisma.readingClubStage.findFirst({ where: { groupId }, orderBy: { stageOrder: 'asc' } });
  }

  /** §18 dashboard: per-group/per-stage reader counts — real aggregate counts, never mock data. `episodeId` omitted -> current episode. */
  async getDashboardStats(episodeId?: string) {
    const resolvedEpisodeId = episodeId ?? (await this.episodes.getCurrentEpisode()).id;
    const groups = await this.prisma.readingClubGroup.findMany({
      where: { episodeId: resolvedEpisodeId },
      orderBy: { name: 'asc' },
      include: { stages: { orderBy: { stageOrder: 'asc' } } },
    });
    const memberships = await this.prisma.readingClubMembership.findMany({ where: { episodeId: resolvedEpisodeId } });
    // A membership whose live group was deleted out from under its reader
    // (READING_CLUB-D16) has `groupId = null` — it still counts toward
    // `totalActiveReaders` (the reader is still a club member, just
    // unassigned) but can't be attributed to any group's own per-group
    // stats below.
    const membershipsByGroup = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      if (!membership.groupId) continue;
      const list = membershipsByGroup.get(membership.groupId) ?? [];
      list.push(membership);
      membershipsByGroup.set(membership.groupId, list);
    }

    return {
      totalGroups: groups.length,
      totalActiveReaders: memberships.length,
      groups: groups.map((group) => {
        const groupMemberships = membershipsByGroup.get(group.id) ?? [];
        return {
          id: group.id,
          name: group.name,
          isActive: group.isActive,
          memberCount: groupMemberships.length,
          stages: group.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
            stageOrder: stage.stageOrder,
            targetType: stage.targetType,
            targetAmount: stage.targetAmount,
            readersOnStageCount: groupMemberships.filter((m) => m.currentStageId === stage.id).length,
          })),
        };
      }),
    };
  }

  // --- internals -----------------------------------------------------------

  private async getGroupOrThrow(id: string) {
    const group = await this.prisma.readingClubGroup.findUnique({
      where: { id },
      include: { stages: { orderBy: { stageOrder: 'asc' } } },
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  private async getStageOrThrow(id: string) {
    const stage = await this.prisma.readingClubStage.findUnique({ where: { id } });
    if (!stage) throw new NotFoundException('Stage not found');
    return stage;
  }

  private translateUniqueConstraintError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return new ConflictException('A stage with this order already exists in this group');
    }
    return error;
  }
}
