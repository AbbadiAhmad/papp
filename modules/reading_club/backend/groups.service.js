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
var GroupsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const episodes_service_1 = require("./episodes.service");
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
let GroupsService = GroupsService_1 = class GroupsService {
    episodes;
    logger = new common_1.Logger(GroupsService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(episodes) {
        this.episodes = episodes;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('reading_club (groups) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    // --- Groups ------------------------------------------------------------
    /**
     * `episodeId` omitted -> current episode's groups. Returns an empty list
     * (rather than throwing) when there is no current episode at all — a
     * reasonable real-world state after the current episode is deleted and
     * before a new one is started (READING_CLUB-D17), not an error.
     */
    async listGroups(episodeId) {
        let resolvedEpisodeId = episodeId;
        if (!resolvedEpisodeId) {
            const current = await this.episodes.findCurrentEpisodeOrNull();
            if (!current)
                return [];
            resolvedEpisodeId = current.id;
        }
        return this.prisma.readingClubGroup.findMany({
            where: { episodeId: resolvedEpisodeId },
            orderBy: { createdAt: 'desc' },
            include: { stages: { orderBy: { stageOrder: 'asc' } } },
        });
    }
    async getGroup(id) {
        return this.getGroupOrThrow(id);
    }
    /**
     * `dto.episodeId` omitted -> the current episode (READING_CLUB-D12).
     * Always rejected if the resolved episode isn't current — including the
     * "no current episode exists at all" case (READING_CLUB-D17), which reads
     * naturally as a 404 from `getCurrentEpisode()`'s own message ("create one
     * first") rather than a separate error path.
     */
    async createGroup(dto, createdBy) {
        const episodeId = dto.episodeId ?? (await this.episodes.getCurrentEpisode()).id;
        await this.episodes.assertEpisodeIsCurrent(episodeId);
        return this.prisma.readingClubGroup.create({
            data: { episodeId, name: dto.name, description: dto.description, isActive: dto.isActive ?? true, createdBy },
            include: { stages: { orderBy: { stageOrder: 'asc' } } },
        });
    }
    async updateGroup(id, dto) {
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
    async removeGroup(id) {
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
    async listStages(groupId) {
        await this.getGroupOrThrow(groupId);
        return this.prisma.readingClubStage.findMany({ where: { groupId }, orderBy: { stageOrder: 'asc' } });
    }
    async createStage(groupId, dto) {
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
        }
        catch (error) {
            throw this.translateUniqueConstraintError(error);
        }
    }
    async updateStage(stageId, dto) {
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
        }
        catch (error) {
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
    async removeStage(stageId) {
        const stage = await this.getStageOrThrow(stageId);
        const group = await this.getGroupOrThrow(stage.groupId);
        await this.episodes.assertEpisodeIsCurrent(group.episodeId);
        const affectedActiveReaderCount = await this.prisma.readingClubMembership.count({ where: { currentStageId: stageId } });
        await this.prisma.readingClubStage.delete({ where: { id: stageId } });
        return { affectedActiveReaderCount };
    }
    /** The stage immediately after `currentStage` in its own group's order, or `null` if `currentStage` is the last one. */
    async findNextStage(groupId, currentStageOrder) {
        return this.prisma.readingClubStage.findFirst({
            where: { groupId, stageOrder: { gt: currentStageOrder } },
            orderBy: { stageOrder: 'asc' },
        });
    }
    /** The group's own first stage (lowest order), used as the default when a membership is assigned with no explicit stage. */
    async findFirstStage(groupId) {
        return this.prisma.readingClubStage.findFirst({ where: { groupId }, orderBy: { stageOrder: 'asc' } });
    }
    /**
     * §18 dashboard: per-group/per-stage reader counts — real aggregate
     * counts, never mock data. `episodeId` omitted -> current episode. When
     * there is no current episode at all (e.g. the librarian just deleted it
     * and hasn't started a new one, READING_CLUB-D17), returns an all-zero/
     * empty stats object instead of throwing — a "no active episode" state is
     * normal, not an error.
     */
    async getDashboardStats(episodeId) {
        let resolvedEpisodeId = episodeId;
        if (!resolvedEpisodeId) {
            const current = await this.episodes.findCurrentEpisodeOrNull();
            if (!current) {
                return { totalGroups: 0, totalActiveReaders: 0, groups: [] };
            }
            resolvedEpisodeId = current.id;
        }
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
        const membershipsByGroup = new Map();
        for (const membership of memberships) {
            if (!membership.groupId)
                continue;
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
    async getGroupOrThrow(id) {
        const group = await this.prisma.readingClubGroup.findUnique({
            where: { id },
            include: { stages: { orderBy: { stageOrder: 'asc' } } },
        });
        if (!group)
            throw new common_1.NotFoundException('Group not found');
        return group;
    }
    async getStageOrThrow(id) {
        const stage = await this.prisma.readingClubStage.findUnique({ where: { id } });
        if (!stage)
            throw new common_1.NotFoundException('Stage not found');
        return stage;
    }
    translateUniqueConstraintError(error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
            return new common_1.ConflictException('A stage with this order already exists in this group');
        }
        return error;
    }
};
exports.GroupsService = GroupsService;
exports.GroupsService = GroupsService = GroupsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [episodes_service_1.EpisodesService])
], GroupsService);
