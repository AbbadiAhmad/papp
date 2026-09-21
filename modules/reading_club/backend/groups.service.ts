import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreateGroupDto } from './dto/create-group.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateStageDto } from './dto/update-stage.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Groups and their ordered stages — "the librarian defines the groups, the
 * stages, the amount in every stage, the present after every stage, the
 * stage order" (the module's own configuration surface, not a generic
 * `system_settings` JSON blob — a relational, orderable list of stages per
 * group doesn't fit that shape, see DECISIONS.md).
 *
 * Own dedicated `PrismaClient` (D57 pattern, same as every other module).
 */
@Injectable()
export class GroupsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GroupsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('reading_club (groups) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // --- Groups ------------------------------------------------------------

  async listGroups() {
    return this.prisma.readingClubGroup.findMany({
      orderBy: { createdAt: 'desc' },
      include: { stages: { orderBy: { stageOrder: 'asc' } } },
    });
  }

  async getGroup(id: string) {
    return this.getGroupOrThrow(id);
  }

  async createGroup(dto: CreateGroupDto, createdBy: string) {
    return this.prisma.readingClubGroup.create({
      data: { name: dto.name, description: dto.description, isActive: dto.isActive ?? true, createdBy },
    });
  }

  async updateGroup(id: string, dto: UpdateGroupDto) {
    await this.getGroupOrThrow(id);
    return this.prisma.readingClubGroup.update({
      where: { id },
      data: { name: dto.name, description: dto.description, isActive: dto.isActive },
    });
  }

  /** Rejects deleting a group any reader has ever been assigned to or completed a stage in — history is permanent, same ethos as library_circulation §10/§22. */
  async removeGroup(id: string): Promise<void> {
    await this.getGroupOrThrow(id);
    const [membershipCount, completionCount] = await Promise.all([
      this.prisma.readingClubMembership.count({ where: { groupId: id } }),
      this.prisma.readingClubStageCompletion.count({ where: { groupId: id } }),
    ]);
    if (membershipCount > 0 || completionCount > 0) {
      throw new ConflictException('This group has readers assigned or completion history and cannot be deleted.');
    }
    await this.prisma.$transaction([
      this.prisma.readingClubStage.deleteMany({ where: { groupId: id } }),
      this.prisma.readingClubGroup.delete({ where: { id } }),
    ]);
  }

  // --- Stages --------------------------------------------------------------

  async listStages(groupId: string) {
    await this.getGroupOrThrow(groupId);
    return this.prisma.readingClubStage.findMany({ where: { groupId }, orderBy: { stageOrder: 'asc' } });
  }

  async createStage(groupId: string, dto: CreateStageDto) {
    await this.getGroupOrThrow(groupId);
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
    await this.getStageOrThrow(stageId);
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

  /** Rejects deleting a stage any reader is currently on or has ever completed — same permanence rule as a group. */
  async removeStage(stageId: string): Promise<void> {
    await this.getStageOrThrow(stageId);
    const [currentCount, completionCount] = await Promise.all([
      this.prisma.readingClubMembership.count({ where: { currentStageId: stageId } }),
      this.prisma.readingClubStageCompletion.count({ where: { stageId } }),
    ]);
    if (currentCount > 0 || completionCount > 0) {
      throw new ConflictException('This stage has readers currently on it or completion history and cannot be deleted.');
    }
    await this.prisma.readingClubStage.delete({ where: { id: stageId } });
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

  /** §18 dashboard: per-group/per-stage reader counts — real aggregate counts, never mock data. */
  async getDashboardStats() {
    const groups = await this.prisma.readingClubGroup.findMany({
      orderBy: { name: 'asc' },
      include: { stages: { orderBy: { stageOrder: 'asc' } } },
    });
    const memberships = await this.prisma.readingClubMembership.findMany();
    const membershipsByGroup = new Map<string, typeof memberships>();
    for (const membership of memberships) {
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
    const group = await this.prisma.readingClubGroup.findUnique({ where: { id } });
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
