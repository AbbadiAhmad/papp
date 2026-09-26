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
};
exports.EpisodesService = EpisodesService;
exports.EpisodesService = EpisodesService = EpisodesService_1 = __decorate([
    (0, common_1.Injectable)()
], EpisodesService);
