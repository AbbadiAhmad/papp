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
var StageBookEntriesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StageBookEntriesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const memberships_service_1 = require("./memberships.service");
/**
 * Per-stage book tracking (item D): every entry — whether auto-synced from
 * a returned borrowing (`MembershipsService.syncStageBookEntries`, see that
 * file) or manually added here — can be listed, discarded (soft, stays
 * visible, excluded from counts) or deleted (hard, gone entirely). Both
 * actions apply equally to auto and manual entries. See DECISIONS.md
 * READING_CLUB-D13/D14 for the full reasoning.
 *
 * Own dedicated `PrismaClient` (D57 pattern).
 */
let StageBookEntriesService = StageBookEntriesService_1 = class StageBookEntriesService {
    memberships;
    logger = new common_1.Logger(StageBookEntriesService_1.name);
    // The library catalog's staff-only internal notes (LIBRARY_CATALOG-D35) must never ride along in this module's responses.
    prisma = new client_1.PrismaClient({ omit: { libraryCatalogBook: { internalNote: true }, libraryCatalogBookCopy: { internalNote: true } } });
    constructor(memberships) {
        this.memberships = memberships;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('reading_club (stage book entries) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    /** Active + discarded entries for the reader's CURRENT stage window (their current membership's group/stage). */
    async listForReader(studentId) {
        const membership = await this.memberships.getMembershipOrThrow(studentId);
        const entries = await this.prisma.readingClubStageBookEntry.findMany({
            where: { studentId, groupId: membership.groupId, stageId: membership.currentStageId },
            orderBy: { addedAt: 'desc' },
        });
        return this.withCatalogInfo(entries);
    }
    /**
     * READING_CLUB-D29: adds the book's catalog `category` + `readingLevel` (read live — not snapshotted) for the
     * "confirm stage" popup. Manual entries with no linked copy, or a since-deleted book, get nulls.
     */
    async withCatalogInfo(entries) {
        const copyIds = [...new Set(entries.map((e) => e.bookCopyId).filter((id) => !!id))];
        const copies = copyIds.length ? ((await this.prisma.libraryCatalogBookCopy.findMany({ where: { id: { in: copyIds } }, select: { id: true, bookId: true } })) ?? []) : [];
        const bookIds = [...new Set(copies.map((c) => c.bookId))];
        const books = bookIds.length ? ((await this.prisma.libraryCatalogBook.findMany({ where: { id: { in: bookIds } }, select: { id: true, category: true, readingLevel: true } })) ?? []) : [];
        const bookByCopy = new Map(copies.map((c) => [c.id, books.find((b) => b.id === c.bookId)]));
        return entries.map((e) => {
            const book = e.bookCopyId ? bookByCopy.get(e.bookCopyId) : undefined;
            return { ...e, category: book?.category ?? null, readingLevel: book?.readingLevel ?? null };
        });
    }
    /** `groupName`/`stageName` are snapshotted from the membership's own current snapshot at add time (READING_CLUB-D16) — consistent with the auto-sync half in MembershipsService.syncStageBookEntries. */
    async addManual(studentId, dto, addedBy) {
        const membership = await this.memberships.getMembershipOrThrow(studentId);
        return this.prisma.readingClubStageBookEntry.create({
            data: {
                studentId,
                episodeId: membership.episodeId,
                groupId: membership.groupId,
                groupName: membership.groupName,
                stageId: membership.currentStageId,
                stageName: membership.stageName,
                bookCopyId: dto.bookCopyId ?? null,
                bookTitle: dto.bookTitle,
                bookCode: dto.bookCode ?? null,
                pageCount: dto.pageCount ?? null,
                comments: dto.comments ?? null,
                source: 'manual',
                addedBy,
            },
        });
    }
    /** Soft: sets status='discarded', keeps the row (struck-through/muted in the UI, excluded from any count). `reason` is optional. */
    async discard(entryId, dto, discardedBy) {
        const entry = await this.getEntryOrThrow(entryId);
        if (entry.status === 'discarded') {
            throw new common_1.ConflictException('This entry is already discarded');
        }
        return this.prisma.readingClubStageBookEntry.update({
            where: { id: entryId },
            data: { status: 'discarded', discardedAt: new Date(), discardedBy, discardReason: dto.reason ?? null },
        });
    }
    /** Hard delete — gone entirely, unlike `discard`. Available for both auto and manual entries. */
    async remove(entryId) {
        await this.getEntryOrThrow(entryId);
        await this.prisma.readingClubStageBookEntry.delete({ where: { id: entryId } });
    }
    async getEntryOrThrow(id) {
        const entry = await this.prisma.readingClubStageBookEntry.findUnique({ where: { id } });
        if (!entry)
            throw new common_1.NotFoundException('Book entry not found');
        return entry;
    }
};
exports.StageBookEntriesService = StageBookEntriesService;
exports.StageBookEntriesService = StageBookEntriesService = StageBookEntriesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [memberships_service_1.MembershipsService])
], StageBookEntriesService);
