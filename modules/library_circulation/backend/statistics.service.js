"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatisticsService = exports.OVERDUE_BUCKETS = void 0;
exports.tally = tally;
exports.ageInYears = ageInYears;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const DAY_MS = 86_400_000;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const mean = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);
const pct = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : null);
/** Counts of each distinct key, largest first (ties alphabetical, "not recorded" last among ties). */
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
exports.OVERDUE_BUCKETS = [
    { label: '1-7', min: 1, max: 7 },
    { label: '8-14', min: 8, max: 14 },
    { label: '15-30', min: 15, max: 30 },
    { label: '31+', min: 31, max: Infinity },
];
/**
 * Library statistics for the librarian and the administrator: how the
 * collection is used, who reads, what is overdue, what fines look like and
 * what each age group borrows — so purchases, promotion and follow-up can be
 * decided on facts. Read-only; own PrismaClient, reading library_catalog's
 * tables directly like the rest of this module does.
 */
let StatisticsService = class StatisticsService {
    prisma = new client_1.PrismaClient();
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
        // --- readers (same "visible reader" rule as the Readers page) --------------
        const [readerRoles, openLoanRows] = await Promise.all([
            this.prisma.userRole.findMany({ where: { role: { code: 'reader' } }, select: { userId: true } }),
            this.prisma.libraryBorrowing.findMany({ where: { returnedAt: null }, select: { studentId: true, bookCopyId: true, dueAt: true, status: true } }),
        ]);
        const readerUserIds = new Set(readerRoles.map((r) => r.userId));
        const openLoanStudentIds = new Set(openLoanRows.filter((l) => l.status === 'active' || l.status === 'overdue').map((l) => l.studentId));
        const students = (await this.prisma.libraryStudent.findMany({ select: { id: true, userId: true, code: true, className: true, createdAt: true } })).filter((s) => readerUserIds.has(s.userId) || openLoanStudentIds.has(s.id));
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
        // --- circulation -----------------------------------------------------------
        const borrowings = await this.prisma.libraryBorrowing.findMany({
            where: range ? { borrowedAt: range } : {},
            select: { studentId: true, bookCopyId: true, status: true, borrowedAt: true },
        });
        const returned = await this.prisma.libraryBorrowing.findMany({
            where: { returnedAt: range ?? { not: null } },
            select: { borrowedAt: true, dueAt: true, returnedAt: true, returnStatus: true },
        });
        const everBorrowedCopies = new Set((await this.prisma.libraryBorrowing.findMany({ select: { bookCopyId: true }, distinct: ['bookCopyId'] })).map((b) => b.bookCopyId));
        // --- collection --------------------------------------------------------------
        const [copies, books, ratingGroups] = await Promise.all([
            this.prisma.libraryCatalogBookCopy.findMany({ select: { id: true, bookId: true, status: true } }),
            this.prisma.libraryCatalogBook.findMany({ select: { id: true, title: true, author: true, category: true, readingLevel: true, createdAt: true } }),
            this.prisma.libraryCatalogBookRating.groupBy({ by: ['bookId'], _avg: { rating: true }, _count: { _all: true } }),
        ]);
        const bookById = new Map(books.map((b) => [b.id, b]));
        const bookIdByCopy = new Map(copies.map((c) => [c.id, c.bookId]));
        const copiesPerBook = new Map();
        for (const c of copies)
            copiesPerBook.set(c.bookId, (copiesPerBook.get(c.bookId) ?? 0) + 1);
        const bookOfCopy = (copyId) => bookById.get(bookIdByCopy.get(copyId) ?? '');
        const ref = (b) => ({ title: b?.title ?? '', author: b?.author ?? null, category: b?.category ?? null });
        const neverBorrowed = books
            .filter((b) => (copiesPerBook.get(b.id) ?? 0) > 0 && !copies.some((c) => c.bookId === b.id && everBorrowedCopies.has(c.id)))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        // --- activity -----------------------------------------------------------------
        const perReader = new Map();
        const perBook = new Map();
        for (const b of borrowings) {
            perReader.set(b.studentId, (perReader.get(b.studentId) ?? 0) + 1);
            const id = bookIdByCopy.get(b.bookCopyId);
            if (id)
                perBook.set(id, (perBook.get(id) ?? 0) + 1);
        }
        const monthly = new Map();
        const weekdays = [0, 0, 0, 0, 0, 0, 0];
        for (const b of borrowings) {
            const month = b.borrowedAt.toISOString().slice(0, 7);
            monthly.set(month, (monthly.get(month) ?? 0) + 1);
            weekdays[b.borrowedAt.getUTCDay()] += 1;
        }
        const lateReturns = returned.filter((r) => r.returnedAt && r.returnedAt > r.dueAt);
        const overdueOpen = openLoanRows.filter((l) => l.dueAt < now);
        const daysLateOf = (dueAt) => Math.ceil((now.getTime() - dueAt.getTime()) / DAY_MS);
        const overdueByStudent = new Map();
        for (const l of overdueOpen) {
            const late = daysLateOf(l.dueAt);
            const cur = overdueByStudent.get(l.studentId) ?? { books: 0, maxDaysLate: 0 };
            overdueByStudent.set(l.studentId, { books: cur.books + 1, maxDaysLate: Math.max(cur.maxDaysLate, late) });
        }
        // --- fines -----------------------------------------------------------------------
        const fines = await this.prisma.libraryFine.findMany({
            where: range ? { createdAt: range } : {},
            select: { amount: true, amountPaid: true, status: true, fineTypeId: true },
        });
        const openFines = await this.prisma.libraryFine.findMany({ where: { status: { in: ['unpaid', 'partially_paid'] } }, select: { amount: true, amountPaid: true } });
        const fineTypes = await this.prisma.libraryFineType.findMany({ select: { id: true, name: true } });
        const fineTypeName = new Map(fineTypes.map((t) => [t.id, t.name]));
        const byType = new Map();
        for (const f of fines) {
            const name = fineTypeName.get(f.fineTypeId) ?? '';
            const cur = byType.get(name) ?? { count: 0, amount: 0 };
            byType.set(name, { count: cur.count + 1, amount: cur.amount + Number(f.amount) });
        }
        // --- readers activity --------------------------------------------------------------
        const classes = new Map();
        for (const s of activeStudents) {
            const key = s.className?.trim() || null;
            const cur = classes.get(key) ?? { readers: 0, borrowings: 0 };
            classes.set(key, { readers: cur.readers + 1, borrowings: cur.borrowings + (perReader.get(s.id) ?? 0) });
        }
        const inactive = activeStudents.filter((s) => !perReader.has(s.id)).sort((a, b) => a.code.localeCompare(b.code));
        // --- ratings -----------------------------------------------------------------------
        const rated = ratingGroups
            .filter((g) => g._count._all >= minRatings && g._avg.rating !== null)
            .sort((a, b) => (b._avg.rating ?? 0) - (a._avg.rating ?? 0) || b._count._all - a._count._all)
            .slice(0, top);
        // --- by age group --------------------------------------------------------------------
        const bandOf = (age) => (age === null ? null : Math.floor(age / bandYears));
        const bandLabel = (index) => (index === null ? null : `${index * bandYears}-${index * bandYears + bandYears - 1}`);
        const readersPerBand = new Map();
        const loansPerBand = new Map();
        for (const s of activeStudents) {
            const band = bandOf(ageOf(s.id));
            readersPerBand.set(band, (readersPerBand.get(band) ?? 0) + 1);
        }
        for (const b of borrowings) {
            const band = bandOf(ageOf(b.studentId));
            loansPerBand.set(band, [...(loansPerBand.get(band) ?? []), b]);
        }
        const bandKeys = new Set([...readersPerBand.keys(), ...loansPerBand.keys()]);
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
        const borrowedBooks = borrowings.map((b) => bookOfCopy(b.bookCopyId));
        return {
            period: { from: query.from?.slice(0, 10) ?? null, to: query.to?.slice(0, 10) ?? null },
            readers: {
                total: students.length,
                active: activeStudents.length,
                withoutDateOfBirth: activeStudents.filter((s) => ageOf(s.id) === null).length,
                newInPeriod: students.filter((s) => range && inRange(s.createdAt)).length,
            },
            collection: {
                titles: books.length,
                copies: copies.length,
                copiesByStatus: tally(copies.map((c) => c.status)),
                newTitles: books.filter((b) => range && inRange(b.createdAt)).length,
                neverBorrowed: {
                    count: neverBorrowed.length,
                    sample: neverBorrowed.slice(0, top).map((b) => ({ ...ref(b), copies: copiesPerBook.get(b.id) ?? 0 })),
                },
            },
            activity: {
                borrowings: borrowings.length,
                returns: returned.length,
                onLoanNow: openLoanRows.length,
                overdueNow: overdueOpen.length,
                borrowers: perReader.size,
                borrowerRatePct: pct(activeStudents.filter((s) => perReader.has(s.id)).length, activeStudents.length),
                avgLoanDays: mean(returned.filter((r) => r.returnedAt).map((r) => (r.returnedAt.getTime() - r.borrowedAt.getTime()) / DAY_MS)),
                onTimeRatePct: pct(returned.length - lateReturns.length, returned.length),
                avgDaysLate: mean(lateReturns.map((r) => Math.ceil((r.returnedAt.getTime() - r.dueAt.getTime()) / DAY_MS))),
                byMonth: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
                byWeekday: weekdays.map((count, weekday) => ({ weekday, count })),
            },
            overdue: {
                buckets: exports.OVERDUE_BUCKETS.map((bucket) => ({
                    key: bucket.label,
                    count: overdueOpen.filter((l) => {
                        const late = daysLateOf(l.dueAt);
                        return late >= bucket.min && late <= bucket.max;
                    }).length,
                })),
                readers: [...overdueByStudent.entries()]
                    .sort((a, b) => b[1].maxDaysLate - a[1].maxDaysLate || b[1].books - a[1].books)
                    .slice(0, top)
                    .map(([studentId, v]) => ({ ...person(studentId), ...v })),
            },
            returnConditions: tally(returned.map((r) => r.returnStatus ?? 'returned')),
            readersActivity: {
                topReaders: [...perReader.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, top)
                    .map(([studentId, count]) => ({ ...person(studentId), borrowings: count })),
                inactive: { count: inactive.length, sample: inactive.slice(0, top).map((s) => person(s.id)) },
                byClass: [...classes.entries()]
                    .map(([className, v]) => ({ className, readers: v.readers, borrowings: v.borrowings, perReader: round1(v.readers ? v.borrowings / v.readers : 0) }))
                    .sort((a, b) => b.perReader - a.perReader),
            },
            books: {
                topBooks: [...perBook.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, top)
                    .map(([bookId, count]) => ({ ...ref(bookById.get(bookId)), count })),
                topRated: rated.map((r) => ({ ...ref(bookById.get(r.bookId)), readingLevel: bookById.get(r.bookId)?.readingLevel ?? null, average: round1(r._avg.rating ?? 0), ratings: r._count._all })),
                categories: tally(borrowedBooks.map((b) => b?.category)),
                levels: tally(borrowedBooks.map((b) => b?.readingLevel)),
                highDemand: [...perBook.entries()]
                    .filter(([, count]) => count >= 2)
                    .map(([bookId, count]) => ({ ...ref(bookById.get(bookId)), borrowings: count, copies: copiesPerBook.get(bookId) ?? 0, perCopy: round1(count / Math.max(1, copiesPerBook.get(bookId) ?? 1)) }))
                    .sort((a, b) => b.perCopy - a.perCopy || b.borrowings - a.borrowings)
                    .slice(0, top),
            },
            fines: {
                issuedCount: fines.length,
                issuedAmount: round2(fines.reduce((s, f) => s + Number(f.amount), 0)),
                paidAmount: round2(fines.reduce((s, f) => s + Number(f.amountPaid), 0)),
                outstandingAmount: round2(openFines.reduce((s, f) => s + Number(f.amount) - Number(f.amountPaid), 0)),
                byStatus: tally(fines.map((f) => f.status)),
                byType: [...byType.entries()].map(([name, v]) => ({ name, count: v.count, amount: round2(v.amount) })).sort((a, b) => b.amount - a.amount),
            },
            byAge: { bandYears, bands },
        };
    }
};
exports.StatisticsService = StatisticsService;
exports.StatisticsService = StatisticsService = __decorate([
    (0, common_1.Injectable)()
], StatisticsService);
