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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReaderImportService = exports.READER_IMPORT_EXTENSION = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const episodes_service_1 = require("./episodes.service");
const memberships_service_1 = require("./memberships.service");
/** Same string as library_circulation's `READER_IMPORT_EXTENSION` (plain string so neither module imports the other). */
exports.READER_IMPORT_EXTENSION = 'papp.library_circulation.reader_import_extension';
/**
 * Club columns of library_circulation's readers import. Always targets the
 * CURRENT episode (the file never names one). Rules per row:
 *  - Club = no            -> remove the reader from the club (no-op if not a member)
 *  - Club Group given     -> member of that group (implies Club = yes); the
 *                            stage is matched by name or order number, blank = group's first stage
 *  - Club = yes, no group -> only valid for a reader who is already a member (no change)
 * An unchanged group+stage never resets a reader's progress.
 */
let ReaderImportService = class ReaderImportService {
    episodes;
    memberships;
    prisma = new client_1.PrismaClient();
    constructor(episodes, memberships) {
        this.episodes = episodes;
        this.memberships = memberships;
    }
    async onModuleInit() {
        await this.prisma.$connect();
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async resolve(row, episodeId) {
        if (!row.clubGroup)
            return {};
        const groups = await this.prisma.readingClubGroup.findMany({ where: { episodeId, isActive: true } });
        const group = groups.find((g) => g.name.trim().toLowerCase() === row.clubGroup.trim().toLowerCase());
        if (!group)
            return { error: `Club group "${row.clubGroup}" not found in the current episode` };
        if (!row.clubStage)
            return { groupId: group.id, stageId: null };
        const stages = await this.prisma.readingClubStage.findMany({ where: { groupId: group.id } });
        const wanted = row.clubStage.trim().toLowerCase();
        const stage = stages.find((s) => s.name.trim().toLowerCase() === wanted) ??
            (/^\d+$/.test(wanted) ? stages.find((s) => s.stageOrder === Number(wanted)) : undefined);
        if (!stage)
            return { error: `Club stage "${row.clubStage}" not found in group "${group.name}"` };
        return { groupId: group.id, stageId: stage.id };
    }
    async validate(rows) {
        const withData = rows.filter((r) => r.club !== null || r.clubGroup || r.clubStage);
        if (withData.length === 0)
            return [];
        const episode = await this.episodes.findCurrentEpisodeOrNull();
        if (!episode)
            return withData.map((r) => ({ row: r.row, error: 'No current reading-club episode — start one first' }));
        const errors = [];
        for (const r of withData) {
            if (r.club === false && (r.clubGroup || r.clubStage)) {
                errors.push({ row: r.row, error: 'Club is "no" but a club group/stage was given' });
            }
            else if (r.clubStage && !r.clubGroup) {
                errors.push({ row: r.row, error: 'Club Stage needs a Club Group' });
            }
            else if (r.club === true && !r.clubGroup) {
                // Allowed only for existing members; that depends on the reader, checked at apply time.
                continue;
            }
            else {
                const resolved = await this.resolve(r, episode.id);
                if (resolved.error)
                    errors.push({ row: r.row, error: resolved.error });
            }
        }
        return errors;
    }
    async apply(entries, actorId) {
        const episode = await this.episodes.findCurrentEpisodeOrNull();
        if (!episode)
            return;
        for (const entry of entries) {
            if (entry.club === null && !entry.clubGroup)
                continue;
            const existing = await this.prisma.readingClubMembership.findUnique({ where: { studentId: entry.studentId } });
            if (entry.club === false) {
                if (existing && existing.episodeId === episode.id)
                    await this.memberships.removeMembership(entry.studentId);
                continue;
            }
            if (!entry.clubGroup)
                continue; // "yes" with no group: nothing to change
            const { groupId, stageId } = await this.resolve(entry, episode.id);
            if (!groupId)
                continue;
            const sameGroup = existing?.episodeId === episode.id && existing.groupId === groupId;
            if (!sameGroup) {
                await this.memberships.assign({ studentId: entry.studentId, groupId, stageId: stageId ?? undefined }, actorId);
            }
            else if (stageId && existing.currentStageId !== stageId) {
                await this.memberships.moveStage(entry.studentId, { stageId });
            }
        }
    }
};
exports.ReaderImportService = ReaderImportService;
exports.ReaderImportService = ReaderImportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [episodes_service_1.EpisodesService,
        memberships_service_1.MembershipsService])
], ReaderImportService);
