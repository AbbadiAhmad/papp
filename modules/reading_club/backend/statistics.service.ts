import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { StatisticsQueryDto } from './dto/statistics-query.dto';
import { EpisodesService } from './episodes.service';

export interface CountEntry {
  /** null = the book has no category / reading level recorded. */
  key: string | null;
  count: number;
}

interface PersonRef {
  studentId: string;
  code: string;
  name: string;
  className: string | null;
}

export interface StageStatistics {
  id: string;
  order: number;
  name: string;
  targetType: 'books' | 'pages';
  targetAmount: number;
  readersNow: number;
  /** Average progress of the readers currently in the stage, capped at 100 per reader; null when nobody is in it. */
  avgProgressPct: number | null;
  /** Average days the current readers have been in the stage so far. */
  avgDaysInStage: number | null;
  completed: number;
  /** completed / (completed + readersNow); null when both are 0. */
  completionRate: number | null;
  categories: CountEntry[];
  levels: CountEntry[];
}

export interface GroupStatistics {
  id: string;
  name: string;
  members: number;
  completions: number;
  categories: CountEntry[];
  levels: CountEntry[];
  stages: StageStatistics[];
}

export interface AgeBandStatistics {
  /** e.g. "8-9"; null = no date of birth recorded. */
  label: string | null;
  readers: number;
  borrowings: number;
  categories: CountEntry[];
  levels: CountEntry[];
  topBooks: Array<{ title: string; count: number }>;
}

export interface Statistics {
  period: { from: string | null; to: string | null };
  readers: { total: number; active: number; withoutDateOfBirth: number };
  library: {
    borrowings: number;
    returned: number;
    borrowers: number;
    overdueNow: number;
    topReaders: Array<PersonRef & { borrowings: number }>;
    topBooks: Array<{ title: string; author: string | null; category: string | null; count: number }>;
    categories: CountEntry[];
    levels: CountEntry[];
  };
  topRated: Array<{ title: string; author: string | null; category: string | null; readingLevel: string | null; average: number; ratings: number }>;
  club: {
    episode: { id: string; name: string; isCurrent: boolean };
    members: number;
    completions: number;
    pendingRewards: number;
    presents: number;
    completionsByMonth: Array<{ month: string; count: number }>;
    topReaders: Array<PersonRef & { groupName: string | null; completions: number; booksRead: number }>;
    categories: CountEntry[];
    levels: CountEntry[];
    groups: GroupStatistics[];
  } | null;
  byAge: { bandYears: number; bands: AgeBandStatistics[] };
}

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Counts of each distinct key, largest first (ties keep a stable alphabetical order; null last among ties). */
export function tally(keys: Array<string | null | undefined>): CountEntry[] {
  const map = new Map<string | null, number>();
  for (const k of keys) {
    const key = k && k.trim() ? k.trim() : null;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key ?? '￿').localeCompare(b.key ?? '￿'));
}

/** Whole years between a date of birth and `now`. */
export function ageInYears(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
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
@Injectable()
export class StatisticsService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  constructor(private readonly episodes: EpisodesService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private range(query: StatisticsQueryDto): { gte?: Date; lte?: Date } | undefined {
    const range: { gte?: Date; lte?: Date } = {};
    if (query.from) range.gte = new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`);
    if (query.to) range.lte = new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`);
    if (range.gte && range.lte && range.gte > range.lte) throw new BadRequestException('The period start is after its end');
    return range.gte || range.lte ? range : undefined;
  }

  async getStatistics(query: StatisticsQueryDto, now: Date = new Date()): Promise<Statistics> {
    const top = query.top ?? 10;
    const bandYears = query.ageBandYears ?? 2;
    const minRatings = query.minRatings ?? 1;
    const range = this.range(query);
    const inRange = (d: Date) => (!range?.gte || d >= range.gte) && (!range?.lte || d <= range.lte);

    // --- readers ------------------------------------------------------------
    // The same "visible reader" rule as the Readers page: holds the reader role, or still has a book out.
    const [readerRoles, openLoans] = await Promise.all([
      this.prisma.userRole.findMany({ where: { role: { code: 'reader' } }, select: { userId: true } }),
      this.prisma.libraryBorrowing.findMany({ where: { status: { in: ['active', 'overdue'] } }, select: { studentId: true }, distinct: ['studentId'] }),
    ]);
    const readerUserIds = new Set(readerRoles.map((r) => r.userId));
    const openLoanStudentIds = new Set(openLoans.map((l) => l.studentId));
    const students = (await this.prisma.libraryStudent.findMany({ select: { id: true, userId: true, code: true, className: true } })).filter(
      (s) => readerUserIds.has(s.userId) || openLoanStudentIds.has(s.id),
    );
    const users = students.length
      ? await this.prisma.user.findMany({
          where: { id: { in: students.map((s) => s.userId) } },
          select: { id: true, name: true, isActive: true, dateOfBirth: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const person = (studentId: string): PersonRef => {
      const s = studentById.get(studentId);
      return { studentId, code: s?.code ?? '', name: userById.get(s?.userId ?? '')?.name ?? s?.code ?? '', className: s?.className ?? null };
    };
    const studentById = new Map(students.map((s) => [s.id, s]));
    const ageOf = (studentId: string): number | null => {
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
    const copyIds = [...new Set([...borrowings.map((b) => b.bookCopyId), ...entries.map((e) => e.bookCopyId).filter((id): id is string => !!id)])];
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
    const bookOfCopy = (copyId: string | null | undefined) => (copyId ? bookById.get(bookIdByCopy.get(copyId) ?? '') : undefined);

    // --- library section ----------------------------------------------------
    const borrowedBooks = borrowings.map((b) => bookOfCopy(b.bookCopyId));
    const perReader = new Map<string, number>();
    const perBook = new Map<string, number>();
    for (const b of borrowings) {
      perReader.set(b.studentId, (perReader.get(b.studentId) ?? 0) + 1);
      const id = bookIdByCopy.get(b.bookCopyId);
      if (id) perBook.set(id, (perBook.get(id) ?? 0) + 1);
    }
    const library: Statistics['library'] = {
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
    const topRated: Statistics['topRated'] = rated.map((r) => {
      const b = bookById.get(r.bookId);
      return { title: b?.title ?? '', author: b?.author ?? null, category: b?.category ?? null, readingLevel: b?.readingLevel ?? null, average: round1(r._avg.rating ?? 0), ratings: r._count._all };
    });

    // --- by age group ---------------------------------------------------------
    const bandOf = (age: number | null): number | null => (age === null ? null : Math.floor(age / bandYears));
    const bandLabel = (index: number | null) => (index === null ? null : `${index * bandYears}-${index * bandYears + bandYears - 1}`);
    const bandKeys = new Set<number | null>();
    const readersPerBand = new Map<number | null, number>();
    for (const s of activeStudents) {
      const band = bandOf(ageOf(s.id));
      bandKeys.add(band);
      readersPerBand.set(band, (readersPerBand.get(band) ?? 0) + 1);
    }
    const loansPerBand = new Map<number | null, typeof borrowings>();
    for (const b of borrowings) {
      const band = bandOf(ageOf(b.studentId));
      bandKeys.add(band);
      loansPerBand.set(band, [...(loansPerBand.get(band) ?? []), b]);
    }
    const bands: AgeBandStatistics[] = [...bandKeys]
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

  private async clubSection(
    episode: { id: string; name: string; isCurrent: boolean },
    ctx: {
      entries: Array<{ studentId: string; episodeId: string; groupId: string | null; stageId: string | null; bookCopyId: string | null; pageCount: number | null; addedAt: Date }>;
      bookOfCopy: (copyId: string | null | undefined) => { category: string | null; readingLevel: string | null } | undefined;
      person: (studentId: string) => PersonRef;
      inRange: (d: Date) => boolean;
      top: number;
      now: Date;
    },
  ): Promise<NonNullable<Statistics['club']>> {
    const { bookOfCopy, person, inRange, top, now } = ctx;
    const groups = await this.prisma.readingClubGroup.findMany({ where: { episodeId: episode.id }, orderBy: { name: 'asc' }, include: { stages: { orderBy: { stageOrder: 'asc' } } } });
    const memberships = await this.prisma.readingClubMembership.findMany({ where: { episodeId: episode.id } });
    const allCompletions = await this.prisma.readingClubStageCompletion.findMany({ where: { episodeId: episode.id } });
    const completions = allCompletions.filter((c) => inRange(c.completedAt));
    const presents = await this.prisma.readingClubPresent.findMany({ where: { episodeId: episode.id }, select: { givenAt: true } });
    const episodeEntries = ctx.entries.filter((e) => e.episodeId === episode.id);
    const periodEntries = episodeEntries.filter((e) => inRange(e.addedAt));

    // Live progress of each member in their current stage (same rules as MembershipsService.computeStageProgress).
    const stageById = new Map(groups.flatMap((g) => g.stages.map((s) => [s.id, s] as const)));
    const memberIds = memberships.map((m) => m.studentId);
    const minStart = memberships.reduce<Date | null>((min, m) => (!min || m.stageStartedAt < min ? m.stageStartedAt : min), null);
    const returned =
      memberIds.length && minStart
        ? await this.prisma.libraryBorrowing.findMany({ where: { studentId: { in: memberIds }, status: 'returned', returnedAt: { gte: minStart } }, select: { studentId: true, returnedAt: true } })
        : [];
    const progressPct = (m: (typeof memberships)[number]): number | null => {
      const stage = m.currentStageId ? stageById.get(m.currentStageId) : undefined;
      if (!stage || stage.targetAmount <= 0) return null;
      const amount =
        stage.targetType === 'books'
          ? returned.filter((r) => r.studentId === m.studentId && r.returnedAt && r.returnedAt >= m.stageStartedAt).length
          : episodeEntries.filter((e) => e.studentId === m.studentId && e.stageId === stage.id).reduce((sum, e) => sum + (e.pageCount ?? 0), 0) + m.manualProgressAmount;
      return Math.min(100, (amount / stage.targetAmount) * 100);
    };
    const mean = (values: number[]) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);
    const entryBooks = (list: typeof periodEntries) => list.map((e) => bookOfCopy(e.bookCopyId));

    const groupStats: GroupStatistics[] = groups.map((g) => {
      const groupEntries = periodEntries.filter((e) => e.groupId === g.id);
      const groupMembers = memberships.filter((m) => m.groupId === g.id);
      return {
        id: g.id,
        name: g.name,
        members: groupMembers.length,
        completions: completions.filter((c) => c.groupId === g.id).length,
        categories: tally(entryBooks(groupEntries).map((b) => b?.category)),
        levels: tally(entryBooks(groupEntries).map((b) => b?.readingLevel)),
        stages: g.stages.map((s): StageStatistics => {
          const now_ = groupMembers.filter((m) => m.currentStageId === s.id);
          const completed = completions.filter((c) => c.stageId === s.id).length;
          const stageEntries = entryBooks(groupEntries.filter((e) => e.stageId === s.id));
          return {
            id: s.id,
            order: s.stageOrder,
            name: s.name,
            targetType: s.targetType as 'books' | 'pages',
            targetAmount: s.targetAmount,
            readersNow: now_.length,
            avgProgressPct: mean(now_.map(progressPct).filter((p): p is number => p !== null)),
            avgDaysInStage: mean(now_.map((m) => (now.getTime() - m.stageStartedAt.getTime()) / DAY_MS)),
            completed,
            completionRate: completed + now_.length > 0 ? round1((completed / (completed + now_.length)) * 100) : null,
            categories: tally(stageEntries.map((b) => b?.category)),
            levels: tally(stageEntries.map((b) => b?.readingLevel)),
          };
        }),
      };
    });

    const byReader = new Map<string, number>();
    for (const c of completions) byReader.set(c.studentId, (byReader.get(c.studentId) ?? 0) + 1);
    const booksByReader = new Map<string, number>();
    for (const e of periodEntries) booksByReader.set(e.studentId, (booksByReader.get(e.studentId) ?? 0) + 1);
    const everyone = new Set([...byReader.keys(), ...booksByReader.keys()]);
    const groupNameOf = new Map(memberships.map((m) => [m.studentId, m.groupName]));
    const topReaders = [...everyone]
      .map((studentId) => ({ ...person(studentId), groupName: groupNameOf.get(studentId) ?? null, completions: byReader.get(studentId) ?? 0, booksRead: booksByReader.get(studentId) ?? 0 }))
      .sort((a, b) => b.completions - a.completions || b.booksRead - a.booksRead)
      .slice(0, top);

    const monthly = new Map<string, number>();
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
}
