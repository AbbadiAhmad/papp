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
var MembershipsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const episodes_service_1 = require("./episodes.service");
const ACTIVE_BORROWING_RETURNED_STATUS = 'returned';
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
let MembershipsService = MembershipsService_1 = class MembershipsService {
    episodes;
    logger = new common_1.Logger(MembershipsService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(episodes) {
        this.episodes = episodes;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('reading_club (memberships) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    /**
     * Readers with (or without) a reading-club membership, filterable by
     * group/stage/free-text search (code or name) — "the librarian can search
     * a specific reader or see readers in a specific group or stage
     * (filters)". Free-text search matches the library student's `code` or
     * their linked `users.name`.
     */
    async listReaders(filter = {}) {
        const episodeId = filter.episodeId ?? (await this.episodes.getCurrentEpisode()).id;
        const memberships = await this.prisma.readingClubMembership.findMany({
            where: {
                episodeId,
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
        const stageIds = memberships.map((m) => m.currentStageId).filter((id) => id !== null);
        const stages = await this.prisma.readingClubStage.findMany({ where: { id: { in: stageIds } } });
        const stagesById = new Map(stages.map((s) => [s.id, s]));
        const rows = await Promise.all(memberships.map(async (membership) => {
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
        }));
        if (!filter.search?.trim())
            return rows;
        const needle = filter.search.trim().toLowerCase();
        return rows.filter((row) => row.studentCode?.toLowerCase().includes(needle) || row.studentName?.toLowerCase().includes(needle));
    }
    /**
     * `actingUserId` is used only as `added_by` if this call triggers the
     * per-stage book-entries auto-sync (a GET needs SOME acting user for that
     * write — there's no "system user" pattern elsewhere in this codebase, see
     * READING_CLUB-D13) — pass `null` to skip the sync entirely (e.g. from a
     * context with no authenticated caller).
     */
    async getReaderDetail(studentId, actingUserId = null) {
        const student = await this.prisma.libraryStudent.findUnique({ where: { id: studentId } });
        if (!student)
            throw new common_1.NotFoundException('Reader (library student) not found');
        const user = await this.prisma.user.findUnique({ where: { id: student.userId } });
        const membership = await this.prisma.readingClubMembership.findUnique({ where: { studentId } });
        let group = null;
        let stage = null;
        let progress = null;
        if (membership) {
            group = await this.prisma.readingClubGroup.findUnique({ where: { id: membership.groupId } });
            if (membership.currentStageId) {
                stage = await this.prisma.readingClubStage.findUnique({ where: { id: membership.currentStageId } });
                if (stage) {
                    progress = await this.computeStageProgress(studentId, membership.stageStartedAt, membership.manualProgressAmount, stage);
                    if (actingUserId) {
                        await this.syncStageBookEntries(membership, stage, actingUserId);
                    }
                }
            }
        }
        const completions = await this.prisma.readingClubStageCompletion.findMany({
            where: { studentId },
            orderBy: { completedAt: 'desc' },
        });
        // A reader can have completions from a PRIOR group (READING_CLUB-D7) —
        // look up each completion's own group/stage rather than assuming the
        // reader's CURRENT group/stage covers every row (item B).
        const completionGroupIds = [...new Set(completions.map((c) => c.groupId))];
        const completionStageIds = [...new Set(completions.map((c) => c.stageId))];
        const [completionGroups, completionStages] = await Promise.all([
            this.prisma.readingClubGroup.findMany({ where: { id: { in: completionGroupIds } } }),
            this.prisma.readingClubStage.findMany({ where: { id: { in: completionStageIds } } }),
        ]);
        const completionGroupsById = new Map(completionGroups.map((g) => [g.id, g]));
        const completionStagesById = new Map(completionStages.map((s) => [s.id, s]));
        const completionRows = completions.map((completion) => ({
            ...completion,
            groupName: completionGroupsById.get(completion.groupId)?.name ?? null,
            stageName: completionStagesById.get(completion.stageId)?.name ?? null,
            stageOrder: completionStagesById.get(completion.stageId)?.stageOrder ?? null,
        }));
        return {
            studentId: student.id,
            studentCode: student.code,
            studentName: user?.name ?? null,
            className: student.className,
            membership,
            group,
            stage,
            progress,
            completions: completionRows,
        };
    }
    /**
     * Auto-populates `reading_club_stage_book_entries` from returned
     * borrowings inside the reader's current stage window — the SAME window
     * `computeStageProgress` uses for books-type stages (`returnedAt >=
     * stageStartedAt`), so the book list and the progress count never diverge.
     * Applies to BOTH books-type and pages-type stages (READING_CLUB-D13): the
     * sync condition is the stage window, not the stage's targetType. Dedups
     * by `borrowingId` existence regardless of status (active OR discarded —
     * a discarded auto-entry is never re-inserted).
     */
    async syncStageBookEntries(membership, stage, actingUserId) {
        const returnedBorrowings = await this.prisma.libraryBorrowing.findMany({
            where: { studentId: membership.studentId, status: ACTIVE_BORROWING_RETURNED_STATUS, returnedAt: { gte: membership.stageStartedAt } },
        });
        if (returnedBorrowings.length === 0)
            return;
        const alreadySynced = await this.prisma.readingClubStageBookEntry.findMany({
            where: { borrowingId: { in: returnedBorrowings.map((b) => b.id) } },
            select: { borrowingId: true },
        });
        const alreadySyncedIds = new Set(alreadySynced.map((e) => e.borrowingId));
        const toSync = returnedBorrowings.filter((b) => !alreadySyncedIds.has(b.id));
        if (toSync.length === 0)
            return;
        for (const borrowing of toSync) {
            const copy = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { id: borrowing.bookCopyId } });
            const book = copy ? await this.prisma.libraryCatalogBook.findUnique({ where: { id: copy.bookId } }) : null;
            await this.prisma.readingClubStageBookEntry.create({
                data: {
                    studentId: membership.studentId,
                    episodeId: membership.episodeId,
                    groupId: membership.groupId,
                    stageId: stage.id,
                    borrowingId: borrowing.id,
                    bookCopyId: copy?.id ?? null,
                    bookTitle: book?.title ?? 'Unknown',
                    bookCode: copy?.qrCode ?? null,
                    source: 'auto',
                    addedBy: actingUserId,
                },
            });
        }
    }
    /** Assigns a reader to a group (first assignment, or moving them to a different group). The membership's `episodeId` follows the TARGET GROUP's own episode; rejected unless that episode is current (READING_CLUB-D12). */
    async assign(dto, assignedBy) {
        const group = await this.prisma.readingClubGroup.findUnique({ where: { id: dto.groupId } });
        if (!group)
            throw new common_1.NotFoundException('Group not found');
        await this.episodes.assertEpisodeIsCurrent(group.episodeId);
        let stageId = dto.stageId ?? null;
        if (stageId) {
            const stage = await this.prisma.readingClubStage.findUnique({ where: { id: stageId } });
            if (!stage || stage.groupId !== dto.groupId) {
                throw new common_1.BadRequestException('The given stage does not belong to the target group');
            }
        }
        else {
            const firstStage = await this.prisma.readingClubStage.findFirst({ where: { groupId: dto.groupId }, orderBy: { stageOrder: 'asc' } });
            stageId = firstStage?.id ?? null;
        }
        return this.prisma.readingClubMembership.upsert({
            where: { studentId: dto.studentId },
            create: {
                studentId: dto.studentId,
                episodeId: group.episodeId,
                groupId: dto.groupId,
                currentStageId: stageId,
                stageStartedAt: new Date(),
                manualProgressAmount: 0,
                assignedBy,
            },
            update: {
                episodeId: group.episodeId,
                groupId: dto.groupId,
                currentStageId: stageId,
                stageStartedAt: new Date(),
                manualProgressAmount: 0,
                assignedBy,
            },
        });
    }
    /** Manually moves a reader to a different stage WITHIN their current group — an administrative override, not the normal "mark complete" reward flow. Rejected unless the membership's episode is current. */
    async moveStage(studentId, dto) {
        const membership = await this.getMembershipOrThrow(studentId);
        await this.episodes.assertEpisodeIsCurrent(membership.episodeId);
        const stage = await this.prisma.readingClubStage.findUnique({ where: { id: dto.stageId } });
        if (!stage || stage.groupId !== membership.groupId) {
            throw new common_1.BadRequestException('The given stage does not belong to this reader\'s current group');
        }
        return this.prisma.readingClubMembership.update({
            where: { studentId },
            data: { currentStageId: stage.id, stageStartedAt: new Date(), manualProgressAmount: 0 },
        });
    }
    /** Records the librarian's manually-tracked running progress amount — the only progress source for a `pages`-type stage (no page-count data exists in the catalog to compute it automatically). Rejected unless the membership's episode is current. */
    async updateManualProgress(studentId, dto) {
        const membership = await this.getMembershipOrThrow(studentId);
        await this.episodes.assertEpisodeIsCurrent(membership.episodeId);
        return this.prisma.readingClubMembership.update({
            where: { studentId },
            data: { manualProgressAmount: dto.manualProgressAmount },
        });
    }
    async computeStageProgress(studentId, stageStartedAt, manualProgressAmount, stage) {
        const targetType = stage.targetType;
        const progressAmount = targetType === 'books'
            ? await this.prisma.libraryBorrowing.count({
                where: { studentId, status: ACTIVE_BORROWING_RETURNED_STATUS, returnedAt: { gte: stageStartedAt } },
            })
            : manualProgressAmount;
        return { targetType, targetAmount: stage.targetAmount, progressAmount, isComplete: progressAmount >= stage.targetAmount };
    }
    async getMembershipOrThrow(studentId) {
        const membership = await this.prisma.readingClubMembership.findUnique({ where: { studentId } });
        if (!membership)
            throw new common_1.NotFoundException('This reader has no reading-club membership yet');
        if (!membership.currentStageId) {
            throw new common_1.ConflictException('This reader has no current stage (their group has no stages, or they already finished the last one)');
        }
        return membership;
    }
};
exports.MembershipsService = MembershipsService;
exports.MembershipsService = MembershipsService = MembershipsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [episodes_service_1.EpisodesService])
], MembershipsService);
