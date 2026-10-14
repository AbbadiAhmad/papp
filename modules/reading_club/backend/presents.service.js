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
var PresentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PresentsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const club_events_1 = require("./club-events");
const episodes_service_1 = require("./episodes.service");
/**
 * A present the librarian gives a reader outside the stage-completion flow
 * (READING_CLUB-D25). Recorded as free text plus a JSON snapshot of the
 * episode/group/stage the reader was in at that moment, so it displays
 * correctly forever. Only allowed in the current episode.
 */
let PresentsService = PresentsService_1 = class PresentsService {
    episodes;
    events;
    logger = new common_1.Logger(PresentsService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(episodes, events) {
        this.episodes = episodes;
        this.events = events;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('reading_club (presents) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async give(studentId, dto, givenBy) {
        const student = await this.prisma.libraryStudent.findUnique({ where: { id: studentId } });
        if (!student)
            throw new common_1.NotFoundException('Reader not found');
        const membership = await this.prisma.readingClubMembership.findUnique({ where: { studentId } });
        const episode = membership ? await this.episodes.getEpisodeOrThrow(membership.episodeId) : await this.episodes.getCurrentEpisode();
        await this.episodes.assertEpisodeIsCurrent(episode.id);
        const description = dto.description.trim();
        const present = await this.prisma.readingClubPresent.create({
            data: {
                studentId,
                episodeId: episode.id,
                description,
                context: { episodeName: episode.name, groupName: membership?.groupName ?? null, stageName: membership?.stageName ?? null },
                givenBy,
            },
        });
        await this.events?.publish({ type: 'reward_given', studentId, details: description });
        return present;
    }
    async getEditablePresent(presentId) {
        const present = await this.prisma.readingClubPresent.findUnique({ where: { id: presentId } });
        if (!present)
            throw new common_1.NotFoundException('Present not found');
        await this.episodes.assertEpisodeIsCurrent(present.episodeId);
        return present;
    }
    /** Corrects the text of an additional present (READING_CLUB-D28). Only in the current episode. */
    async update(presentId, dto) {
        await this.getEditablePresent(presentId);
        return this.prisma.readingClubPresent.update({ where: { id: presentId }, data: { description: dto.description.trim() } });
    }
    /** Removes an additional present recorded by mistake (READING_CLUB-D28). Only in the current episode. */
    async remove(presentId) {
        await this.getEditablePresent(presentId);
        await this.prisma.readingClubPresent.delete({ where: { id: presentId } });
        return { removed: true };
    }
};
exports.PresentsService = PresentsService;
exports.PresentsService = PresentsService = PresentsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __param(1, (0, common_1.Inject)(club_events_1.CLUB_EVENT_PUBLISHER)),
    __metadata("design:paramtypes", [episodes_service_1.EpisodesService, Object])
], PresentsService);
