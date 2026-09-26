"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var EpisodesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EpisodesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
/**
 * Episodes (seasons/years) — the top-level scope everything else in this
 * module now lives under (groups/stages/memberships/completions/book
 * entries). One global "current" episode at a time (READING_CLUB-D10):
 * starting a new one closes whatever was previously current, in the same
 * transaction, so there is never a moment with zero or multiple current
 * episodes visible to a concurrent reader.
 *
 * Own dedicated `PrismaClient` (D57 pattern, same as every other service in
 * this module).
 */
let EpisodesService = EpisodesService_1 = class EpisodesService {
    logger = new common_1.Logger(EpisodesService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('reading_club (episodes) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async listEpisodes() {
        return this.prisma.readingClubEpisode.findMany({ orderBy: { startsAt: 'desc' } });
    }
    async getCurrentEpisode() {
        const current = await this.prisma.readingClubEpisode.findFirst({ where: { isCurrent: true } });
        if (!current)
            throw new common_1.NotFoundException('No current episode — create one first');
        return current;
    }
    /** Same lookup as `getCurrentEpisode` but returns `null` instead of throwing — for callers that want to default to "current" without failing hard when none exists yet. */
    async findCurrentEpisodeOrNull() {
        return this.prisma.readingClubEpisode.findFirst({ where: { isCurrent: true } });
    }
    async getEpisodeOrThrow(id) {
        const episode = await this.prisma.readingClubEpisode.findUnique({ where: { id } });
        if (!episode)
            throw new common_1.NotFoundException('Episode not found');
        return episode;
    }
    /** Rejects a mutation against a non-current episode (past episodes are read-only) — see READING_CLUB-D12. */
    async assertEpisodeIsCurrent(episodeId) {
        const episode = await this.getEpisodeOrThrow(episodeId);
        if (!episode.isCurrent) {
            throw new common_1.ConflictException('This episode is closed — only the current episode can be modified');
        }
    }
    /** Closes whatever episode is currently open (if any) and starts a new one, in one transaction. */
    async createEpisode(dto, createdBy) {
        const previouslyCurrent = await this.prisma.readingClubEpisode.findFirst({ where: { isCurrent: true } });
        const ops = [];
        if (previouslyCurrent) {
            ops.push(this.prisma.readingClubEpisode.update({
                where: { id: previouslyCurrent.id },
                data: { isCurrent: false, endsAt: new Date() },
            }));
        }
        ops.push(this.prisma.readingClubEpisode.create({
            data: { name: dto.name, isCurrent: true, createdBy },
        }));
        const results = await this.prisma.$transaction(ops);
        return results[results.length - 1];
    }
    /**
     * Real counts of everything a delete would cascade away — feeds the
     * frontend's blast-radius warning before the librarian types the
     * confirmation name (READING_CLUB-D17). Cheap aggregate counts, no row
     * data fetched.
     */
    async getDeletePreview(id) {
        const episode = await this.getEpisodeOrThrow(id);
        const groupIds = (await this.prisma.readingClubGroup.findMany({ where: { episodeId: id }, select: { id: true } })).map((g) => g.id);
        const [groupCount, readerCount, completionCount, bookEntryCount] = await Promise.all([
            Promise.resolve(groupIds.length),
            this.prisma.readingClubMembership.count({ where: { episodeId: id } }),
            this.prisma.readingClubStageCompletion.count({ where: { episodeId: id } }),
            this.prisma.readingClubStageBookEntry.count({ where: { episodeId: id } }),
        ]);
        return {
            episodeId: id,
            isCurrent: episode.isCurrent,
            groupCount,
            readerCount,
            completionCount,
            bookEntryCount,
        };
    }
    /**
     * Full cascade delete (READING_CLUB-D17) — deliberately different from the
     * group/stage delete-with-history feature (READING_CLUB-D16): deleting the
     * EPISODE ITSELF removes the whole context it defines, so there is no
     * "keep the history but null the reference" angle here — if the episode
     * is gone, everything scoped under it (its own groups/stages plus every
     * membership/completion/book-entry carrying its `episode_id`) is gone too,
     * full stop. No new migration/FK change: no FK currently points AT
     * `reading_club_episodes` with any ON DELETE action (confirmed by reading
     * 001/002/003 in full — the default is blocking/NO ACTION), so this is
     * implemented as an explicit ordered transaction, deleting children before
     * parents, the same pattern `GroupsService.removeGroup` already uses for
     * its own stages. Any episode is deletable, including the current one —
     * deleting the current episode simply leaves none current (no
     * auto-promotion of another episode; the librarian starts/selects a new
     * one explicitly via the existing "start new episode" flow).
     */
    async deleteEpisode(id) {
        const episode = await this.getEpisodeOrThrow(id);
        const groupIds = (await this.prisma.readingClubGroup.findMany({ where: { episodeId: id }, select: { id: true } })).map((g) => g.id);
        const preview = await this.getDeletePreview(id);
        await this.prisma.$transaction([
            this.prisma.readingClubStageBookEntry.deleteMany({ where: { episodeId: id } }),
            this.prisma.readingClubStageCompletion.deleteMany({ where: { episodeId: id } }),
            this.prisma.readingClubMembership.deleteMany({ where: { episodeId: id } }),
            ...(groupIds.length > 0 ? [this.prisma.readingClubStage.deleteMany({ where: { groupId: { in: groupIds } } })] : []),
            this.prisma.readingClubGroup.deleteMany({ where: { episodeId: id } }),
            this.prisma.readingClubEpisode.delete({ where: { id } }),
        ]);
        return {
            affectedGroupCount: preview.groupCount,
            affectedReaderCount: preview.readerCount,
            affectedCompletionCount: preview.completionCount,
            affectedBookEntryCount: preview.bookEntryCount,
            wasCurrent: episode.isCurrent,
        };
    }
};
exports.EpisodesService = EpisodesService;
exports.EpisodesService = EpisodesService = EpisodesService_1 = __decorate([
    (0, common_1.Injectable)()
], EpisodesService);
