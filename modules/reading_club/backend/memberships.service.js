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
        let episodeId = filter.episodeId;
        if (!episodeId) {
            const current = await this.episodes.findCurrentEpisodeOrNull();
            // No current episode at all (e.g. just deleted, none started yet,
            // READING_CLUB-D17) -> an empty reader list is the correct, non-error
            // representation of "no active episode", not a thrown 404.
            if (!current)
                return [];
            episodeId = current.id;
        }
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
        // Stage lookup is still needed to compute LIVE progress for a reader
        // still actively on a (necessarily live, non-deleted) stage — but the
        // DISPLAYED group/stage name always comes from the membership's own
        // snapshot (READING_CLUB-D16), never this join, so a membership whose
        // live group/stage was since deleted still shows the right name instead
        // of null.
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
                groupName: membership.groupName,
                currentStageId: membership.currentStageId,
                stageName: membership.stageName,
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
        // A membership's `groupId`/`currentStageId` can now be null — set by
        // `ON DELETE SET NULL` (migration 003) when the librarian deletes the
        // group/stage this reader was actively assigned to (READING_CLUB-D16).
        // `group`/`stage` below stay the LIVE rows (used for e.g. the "move
        // stage" picker's list of sibling stages) and are simply null in that
        // case — the reader shows as unassigned/needing re-assignment, their
        // membership row's own `groupName`/`stageName` snapshot still shows
        // what they WERE in (see the frontend's handling of this).
        let group = null;
        let stage = null;
        let progress = null;
        if (membership?.groupId) {
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
        // Every completion's group/stage NAME comes from its own snapshot
        // (`groupName`/`stageName`/`stageOrder`, taken at markComplete time),
        // never a live join — a completion is append-only history and must
        // display correctly forever, including after its group/stage row is
        // later deleted (READING_CLUB-D16; a live join would return null the
        // moment that happens, silently breaking the group/stage columns this
        // session's earlier commit just added).
        const completionRows = completions.map((completion) => ({
            ...completion,
            groupName: completion.groupName,
            stageName: completion.stageName,
            stageOrder: completion.stageOrder,
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
                    groupName: membership.groupName,
                    stageId: stage.id,
                    stageName: membership.stageName,
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
    /**
     * Assigns a reader to a group (first assignment, or moving them to a
     * different group). The membership's `episodeId` follows the TARGET
     * GROUP's own episode; rejected unless that episode is current
     * (READING_CLUB-D12). `groupName`/`stageName` are snapshotted fresh here
     * (READING_CLUB-D16) — every write path re-snapshots, so the CURRENT
     * membership's displayed name is always exactly what it was assigned as,
     * never stale, and keeps displaying correctly even if the live group/
     * stage is later deleted out from under this reader.
     */
    async assign(dto, assignedBy) {
        const group = await this.prisma.readingClubGroup.findUnique({ where: { id: dto.groupId } });
        if (!group)
            throw new common_1.NotFoundException('Group not found');
        await this.episodes.assertEpisodeIsCurrent(group.episodeId);
        let stageId = dto.stageId ?? null;
        let stageName = null;
        if (stageId) {
            const stage = await this.prisma.readingClubStage.findUnique({ where: { id: stageId } });
            if (!stage || stage.groupId !== dto.groupId) {
                throw new common_1.BadRequestException('The given stage does not belong to the target group');
            }
            stageName = stage.name;
        }
        else {
            const firstStage = await this.prisma.readingClubStage.findFirst({ where: { groupId: dto.groupId }, orderBy: { stageOrder: 'asc' } });
            stageId = firstStage?.id ?? null;
            stageName = firstStage?.name ?? null;
        }
        return this.prisma.readingClubMembership.upsert({
            where: { studentId: dto.studentId },
            create: {
                studentId: dto.studentId,
                episodeId: group.episodeId,
                groupId: dto.groupId,
                groupName: group.name,
                currentStageId: stageId,
                stageName,
                stageStartedAt: new Date(),
                manualProgressAmount: 0,
                assignedBy,
            },
            update: {
                episodeId: group.episodeId,
                groupId: dto.groupId,
                groupName: group.name,
                currentStageId: stageId,
                stageName,
                stageStartedAt: new Date(),
                manualProgressAmount: 0,
                assignedBy,
            },
        });
    }
    /** Manually moves a reader to a different stage WITHIN their current group — an administrative override, not the normal "mark complete" reward flow. Rejected unless the membership's episode is current. Re-snapshots `stageName` (READING_CLUB-D16). */
    async moveStage(studentId, dto) {
        const membership = await this.getMembershipOrThrow(studentId);
        await this.episodes.assertEpisodeIsCurrent(membership.episodeId);
        const stage = await this.prisma.readingClubStage.findUnique({ where: { id: dto.stageId } });
        if (!stage || stage.groupId !== membership.groupId) {
            throw new common_1.BadRequestException('The given stage does not belong to this reader\'s current group');
        }
        return this.prisma.readingClubMembership.update({
            where: { studentId },
            data: { currentStageId: stage.id, stageName: stage.name, stageStartedAt: new Date(), manualProgressAmount: 0 },
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
