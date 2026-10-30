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
exports.StatisticsService = void 0;
exports.tally = tally;
exports.ageInYears = ageInYears;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const episodes_service_1 = require("./episodes.service");
const DAY_MS = 86_400_000;
const round1 = (n) => Math.round(n * 10) / 10;
/** Counts of each distinct key, largest first (ties keep a stable alphabetical order; null last among ties). */
function tally(keys) {
    const map = new Map();
    for (const k of keys) {
        const key = k && k.trim() ? k.trim() : null;
        map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || (a.key ?? '￿').localeCompare(b.key ?? '￿'));
}
/** Whole years between a date of birth and `now`. */
function ageInYears(dateOfBirth, now) {
    let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
    const beforeBirthday = now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
        (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
    if (beforeBirthday)
        age -= 1;
    return age;
}
/**
 * Club + library statistics for the librarian: how readers progress through
 * the stages, what they read (category / reading level) per group, stage and
 * age group, who the top readers are and which books are rated best — so the
 * stage targets, the levels and the book purchases can be judged on facts.
 * Read-only; own PrismaClient, reading library_circulation / library_catalog
 * tables directly (the same coupling reading_club already has).
 */
let StatisticsService = class StatisticsService {
    episodes;
    // The library catalog's staff-only internal notes (LIBRARY_CATALOG-D35) must never ride along in this module's responses.
    prisma = new client_1.PrismaClient({ omit: { libraryCatalogBook: { internalNote: true }, libraryCatalogBookCopy: { internalNote: true } } });
    constructor(episodes) {
        this.episodes = episodes;
    }
    async onModuleInit() {
        await this.prisma.$connect();
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    range(query) {
        const range = {};
        if (query.from)
            range.gte = new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`);
        if (query.to)
            range.lte = new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`);
        if (range.gte && range.lte && range.gte > range.lte)
            throw new common_1.BadRequestException('The period start is after its end');
        return range.gte || range.lte ? range : undefined;
    }
    async getStatistics(query, now = new Date()) {
        const top = query.top ?? 10;
        const bandYears = query.ageBandYears ?? 2;
        const range = this.range(query);
        const inRange = (d) => (!range?.gte || d >= range.gte) && (!range?.lte || d <= range.lte);
        const period = { from: query.from?.slice(0, 10) ?? null, to: query.to?.slice(0, 10) ?? null };
        // --- readers (same "visible reader" rule as the Readers page) ---------------
        const [readerRoles, openLoans] = await Promise.all([
            this.prisma.userRole.findMany({ where: { role: { code: 'reader' } }, select: { userId: true } }),
            this.prisma.libraryBorrowing.findMany({ where: { status: { in: ['active', 'overdue'] } }, select: { studentId: true }, distinct: ['studentId'] }),
        ]);
        const readerUserIds = new Set(readerRoles.map((r) => r.userId));
        const openLoanStudentIds = new Set(openLoans.map((l) => l.studentId));
        const students = (await this.prisma.libraryStudent.findMany({ select: { id: true, userId: true, code: true, className: true } })).filter((s) => readerUserIds.has(s.userId) || openLoanStudentIds.has(s.id));
        const users = students.length
            ? await this.prisma.user.findMany({ where: { id: { in: students.map((s) => s.userId) } }, select: { id: true, name: true, isActive: true, dateOfBirth: true } })
            : [];
        const userById = new Map(users.map((u) => [u.id, u]));
        const studentById = new Map(students.map((s) => [s.id, s]));
        const person = (studentId) => {
            const s = studentById.get(studentId);
            return { studentId, code: s?.code ?? '', name: userById.get(s?.userId ?? '')?.name ?? s?.code ?? '', className: s?.className ?? null };
        };
        const ageOf = (studentId) => {
            const dob = userById.get(studentById.get(studentId)?.userId ?? '')?.dateOfBirth;
            return dob ? ageInYears(dob, now) : null;
        };
        const activeStudents = students.filter((s) => userById.get(s.userId)?.isActive !== false);
        const episode = query.episodeId ? await this.prisma.readingClubEpisode.findUnique({ where: { id: query.episodeId } }) : await this.episodes.findCurrentEpisodeOrNull();
        const allEpisodes = await this.prisma.readingClubEpisode.findMany({ orderBy: { startsAt: 'desc' } });
        const episodeGroups = await this.prisma.readingClubGroup.groupBy({ by: ['episodeId'], _count: { _all: true } });
        const allCompletions = await this.prisma.readingClubStageCompletion.findMany({
            select: { studentId: true, episodeId: true, groupId: true, stageId: true, completedAt: true, rewardStatus: true, rewardDeliveredAt: true },
        });
        const episodes = allEpisodes.map((e) => {
            const done = allCompletions.filter((c) => c.episodeId === e.id);
            return {
                id: e.id,
                name: e.name,
                isCurrent: e.isCurrent,
                groups: episodeGroups.find((g) => g.episodeId === e.id)?._count._all ?? 0,
                completions: done.length,
                readersWithCompletion: new Set(done.map((c) => c.studentId)).size,
            };
        });
        if (!episode) {
            return {
                period, episode: null,
                participation: { activeReaders: activeStudents.length, members: 0, participationPct: null, finishedAllStages: 0, borrowingsPerMember: null, borrowingsPerNonMember: null },
                achievements: { completions: 0, presents: 0, completionsByMonth: [] },
                rewards: { pending: 0, oldestPendingDays: null, avgDaysToDeliver: null },
                topReaders: [], stalled: [], categories: [], levels: [], groups: [],
                byAge: { bandYears, bands: [] }, episodes,
            };
        }
        // --- club data of the episode ---------------------------------------------------
        const groups = await this.prisma.readingClubGroup.findMany({ where: { episodeId: episode.id }, orderBy: { name: 'asc' }, include: { stages: { orderBy: { stageOrder: 'asc' } } } });
        const memberships = await this.prisma.readingClubMembership.findMany({ where: { episodeId: episode.id } });
        const completions = allCompletions.filter((c) => c.episodeId === episode.id && inRange(c.completedAt));
        const episodeCompletions = allCompletions.filter((c) => c.episodeId === episode.id);
        const presents = await this.prisma.readingClubPresent.findMany({ where: { episodeId: episode.id }, select: { givenAt: true } });
        const entries = await this.prisma.readingClubStageBookEntry.findMany({ where: { episodeId: episode.id, status: 'active' } });
        const periodEntries = entries.filter((e) => inRange(e.addedAt));
        // Category / level of every book that appears in a club entry.
        const copyIds = [...new Set(entries.map((e) => e.bookCopyId).filter((id) => !!id))];
        const copies = copyIds.length ? await this.prisma.libraryCatalogBookCopy.findMany({ where: { id: { in: copyIds } }, select: { id: true, bookId: true } }) : [];
        const bookIds = [...new Set(copies.map((c) => c.bookId))];
        const books = bookIds.length ? await this.prisma.libraryCatalogBook.findMany({ where: { id: { in: bookIds } }, select: { id: true, category: true, readingLevel: true } }) : [];
        const bookById = new Map(books.map((b) => [b.id, b]));
        const bookIdByCopy = new Map(copies.map((c) => [c.id, c.bookId]));
        const bookOfCopy = (copyId) => (copyId ? bookById.get(bookIdByCopy.get(copyId) ?? '') : undefined);
        const entryBooks = (list) => list.map((e) => bookOfCopy(e.bookCopyId));
        // Live progress of each member in their current stage (same rules as MembershipsService.computeStageProgress).
        const stageById = new Map(groups.flatMap((g) => g.stages.map((st) => [st.id, st])));
        const memberIds = memberships.map((m) => m.studentId);
        const minStart = memberships.reduce((min, m) => (!min || m.stageStartedAt < min ? m.stageStartedAt : min), null);
        const returned = memberIds.length && minStart
            ? await this.prisma.libraryBorrowing.findMany({ where: { studentId: { in: memberIds }, status: 'returned', returnedAt: { gte: minStart } }, select: { studentId: true, returnedAt: true } })
            : [];
        const progressPct = (m) => {
            const stage = m.currentStageId ? stageById.get(m.currentStageId) : undefined;
            if (!stage || stage.targetAmount <= 0)
                return null;
            const amount = stage.targetType === 'books'
                ? returned.filter((r) => r.studentId === m.studentId && r.returnedAt && r.returnedAt >= m.stageStartedAt).length
                : entries.filter((e) => e.studentId === m.studentId && e.stageId === stage.id).reduce((sum, e) => sum + (e.pageCount ?? 0), 0) + m.manualProgressAmount;
            return Math.min(100, (amount / stage.targetAmount) * 100);
        };
        const mean = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);
        const groupStats = groups.map((g) => {
            const groupEntries = periodEntries.filter((e) => e.groupId === g.id);
            const groupMembers = memberships.filter((m) => m.groupId === g.id);
            return {
                id: g.id,
                name: g.name,
                members: groupMembers.length,
                completions: completions.filter((c) => c.groupId === g.id).length,
                categories: tally(entryBooks(groupEntries).map((b) => b?.category)),
                levels: tally(entryBooks(groupEntries).map((b) => b?.readingLevel)),
                stages: g.stages.map((st) => {
                    const here = groupMembers.filter((m) => m.currentStageId === st.id);
                    const completed = completions.filter((c) => c.stageId === st.id).length;
                    const stageBooks = entryBooks(groupEntries.filter((e) => e.stageId === st.id));
                    return {
                        id: st.id,
                        order: st.stageOrder,
                        name: st.name,
                        targetType: st.targetType,
                        targetAmount: st.targetAmount,
                        readersNow: here.length,
                        avgProgressPct: mean(here.map(progressPct).filter((p) => p !== null)),
                        avgDaysInStage: mean(here.map((m) => (now.getTime() - m.stageStartedAt.getTime()) / DAY_MS)),
                        completed,
                        completionRate: completed + here.length > 0 ? round1((completed / (completed + here.length)) * 100) : null,
                        categories: tally(stageBooks.map((b) => b?.category)),
                        levels: tally(stageBooks.map((b) => b?.readingLevel)),
                    };
                }),
            };
        });
        // --- top readers, stalled members -------------------------------------------------------
        const byReader = new Map();
        for (const c of completions)
            byReader.set(c.studentId, (byReader.get(c.studentId) ?? 0) + 1);
        const booksByReader = new Map();
        for (const e of periodEntries)
            booksByReader.set(e.studentId, (booksByReader.get(e.studentId) ?? 0) + 1);
        const groupNameOf = new Map(memberships.map((m) => [m.studentId, m.groupName]));
        const topReaders = [...new Set([...byReader.keys(), ...booksByReader.keys()])]
            .map((studentId) => ({ ...person(studentId), groupName: groupNameOf.get(studentId) ?? null, completions: byReader.get(studentId) ?? 0, booksRead: booksByReader.get(studentId) ?? 0 }))
            .sort((a, b) => b.completions - a.completions || b.booksRead - a.booksRead)
            .slice(0, top);
        const stalled = memberships
            .filter((m) => m.currentStageId)
            .map((m) => ({ ...person(m.studentId), groupName: m.groupName, stageName: m.stageName, daysInStage: Math.floor((now.getTime() - m.stageStartedAt.getTime()) / DAY_MS), progressPct: progressPct(m) }))
            .filter((m) => m.progressPct === null || m.progressPct < 100)
            .sort((a, b) => b.daysInStage - a.daysInStage)
            .slice(0, top)
            .map((m) => ({ ...m, progressPct: m.progressPct === null ? null : round1(m.progressPct) }));
        // --- participation + club vs non-club borrowing ---------------------------------------------
        const memberSet = new Set(memberIds);
        const periodBorrowings = await this.prisma.libraryBorrowing.findMany({ where: range ? { borrowedAt: range } : {}, select: { studentId: true } });
        const loansOf = (ids) => periodBorrowings.filter((b) => ids.has(b.studentId)).length;
        const activeIds = new Set(activeStudents.map((s) => s.id));
        const activeMembers = [...memberSet].filter((id) => activeIds.has(id));
        const activeNonMembers = [...activeIds].filter((id) => !memberSet.has(id));
        const perHead = (count, heads) => (heads > 0 ? round1(count / heads) : null);
        // --- rewards ------------------------------------------------------------------------------------
        const pending = episodeCompletions.filter((c) => c.rewardStatus === 'pending');
        const delivered = episodeCompletions.filter((c) => c.rewardDeliveredAt);
        // --- by age group -----------------------------------------------------------------------------------
        const bandOf = (age) => (age === null ? null : Math.floor(age / bandYears));
        const bandKeys = new Set();
        const membersPerBand = new Map();
        for (const id of memberIds) {
            const band = bandOf(ageOf(id));
            bandKeys.add(band);
            membersPerBand.set(band, [...(membersPerBand.get(band) ?? []), id]);
        }
        const bands = [...bandKeys]
            .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
            .map((band) => {
            const ids = new Set(membersPerBand.get(band) ?? []);
            return {
                label: band === null ? null : `${band * bandYears}-${band * bandYears + bandYears - 1}`,
                members: ids.size,
                completions: completions.filter((c) => ids.has(c.studentId)).length,
                categories: tally(entryBooks(periodEntries.filter((e) => ids.has(e.studentId))).map((b) => b?.category)),
            };
        });
        const monthly = new Map();
        for (const c of completions) {
            const month = c.completedAt.toISOString().slice(0, 7);
            monthly.set(month, (monthly.get(month) ?? 0) + 1);
        }
        return {
            period,
            episode: { id: episode.id, name: episode.name, isCurrent: episode.isCurrent },
            participation: {
                activeReaders: activeStudents.length,
                members: memberships.length,
                participationPct: activeStudents.length ? round1((activeMembers.length / activeStudents.length) * 100) : null,
                finishedAllStages: memberships.filter((m) => m.groupId && !m.currentStageId).length,
                borrowingsPerMember: perHead(loansOf(new Set(activeMembers)), activeMembers.length),
                borrowingsPerNonMember: perHead(loansOf(new Set(activeNonMembers)), activeNonMembers.length),
            },
            achievements: {
                completions: completions.length,
                presents: presents.filter((p) => inRange(p.givenAt)).length,
                completionsByMonth: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
            },
            rewards: {
                pending: pending.length,
                oldestPendingDays: pending.length ? Math.floor((now.getTime() - Math.min(...pending.map((c) => c.completedAt.getTime()))) / DAY_MS) : null,
                avgDaysToDeliver: mean(delivered.map((c) => (c.rewardDeliveredAt.getTime() - c.completedAt.getTime()) / DAY_MS)),
            },
            topReaders,
            stalled,
            categories: tally(entryBooks(periodEntries).map((b) => b?.category)),
            levels: tally(entryBooks(periodEntries).map((b) => b?.readingLevel)),
            groups: groupStats,
            byAge: { bandYears, bands },
            episodes,
        };
    }
};
exports.StatisticsService = StatisticsService;
exports.StatisticsService = StatisticsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [episodes_service_1.EpisodesService])
], StatisticsService);
