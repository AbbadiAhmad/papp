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
    prisma = new client_1.PrismaClient();
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
        const minRatings = query.minRatings ?? 1;
        const range = this.range(query);
        const inRange = (d) => (!range?.gte || d >= range.gte) && (!range?.lte || d <= range.lte);
        // --- readers ------------------------------------------------------------
        // The same "visible reader" rule as the Readers page: holds the reader role, or still has a book out.
        const [readerRoles, openLoans] = await Promise.all([
            this.prisma.userRole.findMany({ where: { role: { code: 'reader' } }, select: { userId: true } }),
            this.prisma.libraryBorrowing.findMany({ where: { status: { in: ['active', 'overdue'] } }, select: { studentId: true }, distinct: ['studentId'] }),
        ]);
        const readerUserIds = new Set(readerRoles.map((r) => r.userId));
        const openLoanStudentIds = new Set(openLoans.map((l) => l.studentId));
        const students = (await this.prisma.libraryStudent.findMany({ select: { id: true, userId: true, code: true, className: true } })).filter((s) => readerUserIds.has(s.userId) || openLoanStudentIds.has(s.id));
        const users = students.length
            ? await this.prisma.user.findMany({
                where: { id: { in: students.map((s) => s.userId) } },
                select: { id: true, name: true, isActive: true, dateOfBirth: true },
            })
            : [];
        const userById = new Map(users.map((u) => [u.id, u]));
        const person = (studentId) => {
            const s = studentById.get(studentId);
            return { studentId, code: s?.code ?? '', name: userById.get(s?.userId ?? '')?.name ?? s?.code ?? '', className: s?.className ?? null };
        };
        const studentById = new Map(students.map((s) => [s.id, s]));
        const ageOf = (studentId) => {
            const dob = userById.get(studentById.get(studentId)?.userId ?? '')?.dateOfBirth;
            return dob ? ageInYears(dob, now) : null;
        };
        const activeStudents = students.filter((s) => userById.get(s.userId)?.isActive !== false);
        // --- borrowings + books -----------------------------------------------
        const borrowings = await this.prisma.libraryBorrowing.findMany({
            where: range ? { borrowedAt: range } : {},
            select: { studentId: true, bookCopyId: true, status: true, borrowedAt: true },
        });
        const overdueNow = await this.prisma.libraryBorrowing.count({
            where: { returnedAt: null, OR: [{ status: 'overdue' }, { status: 'active', dueAt: { lt: now } }] },
        });
        const entries = await this.prisma.readingClubStageBookEntry.findMany({ where: { status: 'active' } });
        const copyIds = [...new Set([...borrowings.map((b) => b.bookCopyId), ...entries.map((e) => e.bookCopyId).filter((id) => !!id)])];
        const copies = copyIds.length ? await this.prisma.libraryCatalogBookCopy.findMany({ where: { id: { in: copyIds } }, select: { id: true, bookId: true } }) : [];
        const bookIdByCopy = new Map(copies.map((c) => [c.id, c.bookId]));
        const ratingGroups = await this.prisma.libraryCatalogBookRating.groupBy({ by: ['bookId'], _avg: { rating: true }, _count: { _all: true } });
        const rated = ratingGroups
            .filter((g) => g._count._all >= minRatings && g._avg.rating !== null)
            .sort((a, b) => (b._avg.rating ?? 0) - (a._avg.rating ?? 0) || b._count._all - a._count._all)
            .slice(0, top);
        const bookIds = [...new Set([...bookIdByCopy.values(), ...rated.map((r) => r.bookId)])];
        const books = bookIds.length
            ? await this.prisma.libraryCatalogBook.findMany({ where: { id: { in: bookIds } }, select: { id: true, title: true, author: true, category: true, readingLevel: true } })
            : [];
        const bookById = new Map(books.map((b) => [b.id, b]));
        const bookOfCopy = (copyId) => (copyId ? bookById.get(bookIdByCopy.get(copyId) ?? '') : undefined);
        // --- library section ----------------------------------------------------
        const borrowedBooks = borrowings.map((b) => bookOfCopy(b.bookCopyId));
        const perReader = new Map();
        const perBook = new Map();
        for (const b of borrowings) {
            perReader.set(b.studentId, (perReader.get(b.studentId) ?? 0) + 1);
            const id = bookIdByCopy.get(b.bookCopyId);
            if (id)
                perBook.set(id, (perBook.get(id) ?? 0) + 1);
        }
        const library = {
            borrowings: borrowings.length,
            returned: borrowings.filter((b) => b.status === 'returned').length,
            borrowers: perReader.size,
            overdueNow,
            topReaders: [...perReader.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, top)
                .map(([studentId, count]) => ({ ...person(studentId), borrowings: count })),
            topBooks: [...perBook.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, top)
                .map(([bookId, count]) => ({ title: bookById.get(bookId)?.title ?? '', author: bookById.get(bookId)?.author ?? null, category: bookById.get(bookId)?.category ?? null, count })),
            categories: tally(borrowedBooks.map((b) => b?.category)),
            levels: tally(borrowedBooks.map((b) => b?.readingLevel)),
        };
        const topRated = rated.map((r) => {
            const b = bookById.get(r.bookId);
            return { title: b?.title ?? '', author: b?.author ?? null, category: b?.category ?? null, readingLevel: b?.readingLevel ?? null, average: round1(r._avg.rating ?? 0), ratings: r._count._all };
        });
        // --- by age group ---------------------------------------------------------
        const bandOf = (age) => (age === null ? null : Math.floor(age / bandYears));
        const bandLabel = (index) => (index === null ? null : `${index * bandYears}-${index * bandYears + bandYears - 1}`);
        const bandKeys = new Set();
        const readersPerBand = new Map();
        for (const s of activeStudents) {
            const band = bandOf(ageOf(s.id));
            bandKeys.add(band);
            readersPerBand.set(band, (readersPerBand.get(band) ?? 0) + 1);
        }
        const loansPerBand = new Map();
        for (const b of borrowings) {
            const band = bandOf(ageOf(b.studentId));
            bandKeys.add(band);
            loansPerBand.set(band, [...(loansPerBand.get(band) ?? []), b]);
        }
        const bands = [...bandKeys]
            .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
            .map((band) => {
            const loans = loansPerBand.get(band) ?? [];
            const loanBooks = loans.map((l) => bookOfCopy(l.bookCopyId));
            return {
                label: bandLabel(band),
                readers: readersPerBand.get(band) ?? 0,
                borrowings: loans.length,
                categories: tally(loanBooks.map((b) => b?.category)),
                levels: tally(loanBooks.map((b) => b?.readingLevel)),
                topBooks: tally(loanBooks.map((b) => b?.title).filter((t) => !!t))
                    .slice(0, 5)
                    .map((e) => ({ title: e.key ?? '', count: e.count })),
            };
        });
        // --- club section ---------------------------------------------------------
        const episode = query.episodeId ? await this.prisma.readingClubEpisode.findUnique({ where: { id: query.episodeId } }) : await this.episodes.findCurrentEpisodeOrNull();
        const club = episode ? await this.clubSection(episode, { entries, bookOfCopy, person, inRange, top, now }) : null;
        return {
            period: { from: query.from?.slice(0, 10) ?? null, to: query.to?.slice(0, 10) ?? null },
            readers: {
                total: students.length,
                active: activeStudents.length,
                withoutDateOfBirth: activeStudents.filter((s) => ageOf(s.id) === null).length,
            },
            library,
            topRated,
            club,
            byAge: { bandYears, bands },
        };
    }
    async clubSection(episode, ctx) {
        const { bookOfCopy, person, inRange, top, now } = ctx;
        const groups = await this.prisma.readingClubGroup.findMany({ where: { episodeId: episode.id }, orderBy: { name: 'asc' }, include: { stages: { orderBy: { stageOrder: 'asc' } } } });
        const memberships = await this.prisma.readingClubMembership.findMany({ where: { episodeId: episode.id } });
        const allCompletions = await this.prisma.readingClubStageCompletion.findMany({ where: { episodeId: episode.id } });
        const completions = allCompletions.filter((c) => inRange(c.completedAt));
        const presents = await this.prisma.readingClubPresent.findMany({ where: { episodeId: episode.id }, select: { givenAt: true } });
        const episodeEntries = ctx.entries.filter((e) => e.episodeId === episode.id);
        const periodEntries = episodeEntries.filter((e) => inRange(e.addedAt));
        // Live progress of each member in their current stage (same rules as MembershipsService.computeStageProgress).
        const stageById = new Map(groups.flatMap((g) => g.stages.map((s) => [s.id, s])));
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
                : episodeEntries.filter((e) => e.studentId === m.studentId && e.stageId === stage.id).reduce((sum, e) => sum + (e.pageCount ?? 0), 0) + m.manualProgressAmount;
            return Math.min(100, (amount / stage.targetAmount) * 100);
        };
        const mean = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);
        const entryBooks = (list) => list.map((e) => bookOfCopy(e.bookCopyId));
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
                stages: g.stages.map((s) => {
                    const now_ = groupMembers.filter((m) => m.currentStageId === s.id);
                    const completed = completions.filter((c) => c.stageId === s.id).length;
                    const stageEntries = entryBooks(groupEntries.filter((e) => e.stageId === s.id));
                    return {
                        id: s.id,
                        order: s.stageOrder,
                        name: s.name,
                        targetType: s.targetType,
                        targetAmount: s.targetAmount,
                        readersNow: now_.length,
                        avgProgressPct: mean(now_.map(progressPct).filter((p) => p !== null)),
                        avgDaysInStage: mean(now_.map((m) => (now.getTime() - m.stageStartedAt.getTime()) / DAY_MS)),
                        completed,
                        completionRate: completed + now_.length > 0 ? round1((completed / (completed + now_.length)) * 100) : null,
                        categories: tally(stageEntries.map((b) => b?.category)),
                        levels: tally(stageEntries.map((b) => b?.readingLevel)),
                    };
                }),
            };
        });
        const byReader = new Map();
        for (const c of completions)
            byReader.set(c.studentId, (byReader.get(c.studentId) ?? 0) + 1);
        const booksByReader = new Map();
        for (const e of periodEntries)
            booksByReader.set(e.studentId, (booksByReader.get(e.studentId) ?? 0) + 1);
        const everyone = new Set([...byReader.keys(), ...booksByReader.keys()]);
        const groupNameOf = new Map(memberships.map((m) => [m.studentId, m.groupName]));
        const topReaders = [...everyone]
            .map((studentId) => ({ ...person(studentId), groupName: groupNameOf.get(studentId) ?? null, completions: byReader.get(studentId) ?? 0, booksRead: booksByReader.get(studentId) ?? 0 }))
            .sort((a, b) => b.completions - a.completions || b.booksRead - a.booksRead)
            .slice(0, top);
        const monthly = new Map();
        for (const c of completions) {
            const month = c.completedAt.toISOString().slice(0, 7);
            monthly.set(month, (monthly.get(month) ?? 0) + 1);
        }
        return {
            episode: { id: episode.id, name: episode.name, isCurrent: episode.isCurrent },
            members: memberships.length,
            completions: completions.length,
            pendingRewards: completions.filter((c) => c.rewardStatus === 'pending').length,
            presents: presents.filter((p) => inRange(p.givenAt)).length,
            completionsByMonth: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
            topReaders,
            categories: tally(entryBooks(periodEntries).map((b) => b?.category)),
            levels: tally(entryBooks(periodEntries).map((b) => b?.readingLevel)),
            groups: groupStats,
        };
    }
};
exports.StatisticsService = StatisticsService;
exports.StatisticsService = StatisticsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [episodes_service_1.EpisodesService])
], StatisticsService);
