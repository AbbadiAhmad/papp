import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { StatisticsService, ageInYears, tally } from '../../backend/statistics.service';

const NOW = new Date('2026-10-14T12:00:00Z');
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('helpers', () => {
  it('tally counts, sorts by count then name, keeps blank as null last', () => {
    expect(tally(['Science', 'Story', 'Science', null, ' ', undefined, 'Story', 'Art'])).toEqual([
      { key: 'Science', count: 2 },
      { key: 'Story', count: 2 },
      { key: null, count: 3 },
      { key: 'Art', count: 1 },
    ].sort((a, b) => b.count - a.count || (a.key ?? '￿').localeCompare(b.key ?? '￿')));
  });

  it('ageInYears is whole years, not yet a year until the birthday', () => {
    expect(ageInYears(d('2016-10-14'), NOW)).toBe(10);
    expect(ageInYears(d('2016-10-15'), NOW)).toBe(9);
    expect(ageInYears(d('2016-11-01'), NOW)).toBe(9);
  });
});

function build(currentEpisode: unknown = { id: 'ep1', name: 'Season 1', isCurrent: true }) {
  const prisma = {
    userRole: { findMany: jest.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]) },
    libraryStudent: {
      findMany: jest.fn(async () => [
        { id: 's1', userId: 'u1', code: 'R1', className: '5A' }, // 10 y
        { id: 's2', userId: 'u2', code: 'R2', className: '6B' }, // no dob
        { id: 's3', userId: 'u3', code: 'R3', className: '5A' }, // inactive, 11 y
      ]),
    },
    user: {
      findMany: jest.fn(async () => [
        { id: 'u1', name: 'Aisha', isActive: true, dateOfBirth: d('2016-03-01') },
        { id: 'u2', name: 'Omar', isActive: true, dateOfBirth: null },
        { id: 'u3', name: 'Zed', isActive: false, dateOfBirth: d('2015-01-01') },
      ]),
    },
    libraryBorrowing: {
      findMany: jest.fn(async (args: { where?: { returnedAt?: unknown; status?: string } }) =>
        args.where?.status === 'returned'
          ? [{ studentId: 's1', returnedAt: d('2026-10-01') }, { studentId: 's1', returnedAt: d('2026-10-05') }]
          : [
              { studentId: 's1', bookCopyId: 'c1', status: 'returned', borrowedAt: d('2026-09-01') },
              { studentId: 's1', bookCopyId: 'c2', status: 'returned', borrowedAt: d('2026-09-10') },
              { studentId: 's1', bookCopyId: 'c1', status: 'active', borrowedAt: d('2026-09-20') },
              { studentId: 's2', bookCopyId: 'c3', status: 'returned', borrowedAt: d('2026-09-12') },
            ],
      ),
      count: jest.fn(async () => 2),
    },
    readingClubStageBookEntry: {
      findMany: jest.fn(async () => [
        { studentId: 's1', episodeId: 'ep1', groupId: 'g1', stageId: 'st1', bookCopyId: 'c1', pageCount: 40, addedAt: d('2026-09-02') },
        { studentId: 's1', episodeId: 'ep1', groupId: 'g1', stageId: 'st1', bookCopyId: 'c2', pageCount: 60, addedAt: d('2026-09-11') },
        { studentId: 's1', episodeId: 'ep1', groupId: 'g1', stageId: 'st1', bookCopyId: null, pageCount: null, addedAt: d('2026-09-12') },
      ]),
    },
    libraryCatalogBookCopy: { findMany: jest.fn(async () => [{ id: 'c1', bookId: 'b1' }, { id: 'c2', bookId: 'b2' }, { id: 'c3', bookId: 'b3' }]) },
    libraryCatalogBookRating: {
      groupBy: jest.fn(async () => [
        { bookId: 'b1', _avg: { rating: 4.5 }, _count: { _all: 4 } },
        { bookId: 'b2', _avg: { rating: 5 }, _count: { _all: 1 } },
        { bookId: 'b3', _avg: { rating: 3 }, _count: { _all: 9 } },
      ]),
    },
    libraryCatalogBook: {
      findMany: jest.fn(async () => [
        { id: 'b1', title: 'Kalila', author: 'A', category: 'Stories', readingLevel: 'L1' },
        { id: 'b2', title: 'Atlas', author: 'B', category: 'Science', readingLevel: 'L2' },
        { id: 'b3', title: 'Sindbad', author: null, category: null, readingLevel: null },
      ]),
    },
    readingClubEpisode: { findUnique: jest.fn(async () => currentEpisode) },
    readingClubGroup: {
      findMany: jest.fn(async () => [
        { id: 'g1', name: 'Eagles', stages: [
          { id: 'st1', stageOrder: 1, name: 'Bronze', targetType: 'pages', targetAmount: 200 },
          { id: 'st2', stageOrder: 2, name: 'Silver', targetType: 'books', targetAmount: 5 },
        ] },
      ]),
    },
    readingClubMembership: {
      findMany: jest.fn(async () => [
        { studentId: 's1', groupId: 'g1', groupName: 'Eagles', currentStageId: 'st1', stageStartedAt: d('2026-09-01'), manualProgressAmount: 20 },
        { studentId: 's2', groupId: 'g1', groupName: 'Eagles', currentStageId: 'st2', stageStartedAt: d('2026-09-30'), manualProgressAmount: 0 },
      ]),
    },
    readingClubStageCompletion: {
      findMany: jest.fn(async () => [
        { studentId: 's1', groupId: 'g1', stageId: 'st1', completedAt: d('2026-08-15'), rewardStatus: 'pending' },
        { studentId: 's3', groupId: 'g1', stageId: 'st1', completedAt: d('2026-09-15'), rewardStatus: 'delivered' },
      ]),
    },
    readingClubPresent: { findMany: jest.fn(async () => [{ givenAt: d('2026-09-16') }]) },
  };
  const episodes = { findCurrentEpisodeOrNull: jest.fn(async () => currentEpisode) };
  const service = new StatisticsService(episodes as never);
  (service as unknown as { prisma: unknown }).prisma = prisma;
  return { service, prisma };
}

describe('StatisticsService.getStatistics', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('counts readers: total, active, and active ones without a date of birth', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.readers).toEqual({ total: 3, active: 2, withoutDateOfBirth: 1 });
  });

  it('counts only visible readers: the reader role, or a book still out', async () => {
    ctx.prisma.userRole.findMany.mockResolvedValue([{ userId: 'u1' }]); // u2/u3 lost the role
    // the default borrowing mock reports an open loan for s1 and s2 -> s2 stays visible, s3 (no role, no loan) drops out
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.readers.total).toBe(2);
  });

  it('library: totals, top readers and books, categories/levels, rated books (min ratings applied)', async () => {
    const s = await ctx.service.getStatistics({ minRatings: 2 }, NOW);
    expect(s.library).toMatchObject({ borrowings: 4, returned: 3, borrowers: 2, overdueNow: 2 });
    expect(s.library.topReaders[0]).toMatchObject({ code: 'R1', name: 'Aisha', borrowings: 3 });
    expect(s.library.topBooks[0]).toMatchObject({ title: 'Kalila', count: 2 });
    expect(s.library.categories).toEqual([{ key: 'Stories', count: 2 }, { key: null, count: 1 }, { key: 'Science', count: 1 }].sort((a, b) => b.count - a.count || (a.key ?? '￿').localeCompare(b.key ?? '￿')));
    // Atlas (5.0) has only 1 rating -> excluded by minRatings 2; Kalila 4.5 beats Sindbad 3.0
    expect(s.topRated.map((b) => [b.title, b.average, b.ratings])).toEqual([['Kalila', 4.5, 4], ['Sindbad', 3, 9]]);
  });

  it('age groups: bands of the chosen width, unknown last, with what each band borrowed', async () => {
    const s = await ctx.service.getStatistics({ ageBandYears: 5 }, NOW);
    expect(s.byAge.bandYears).toBe(5);
    // Aisha is 10 -> band "10-14"; Omar unknown
    expect(s.byAge.bands.map((b) => b.label)).toEqual(['10-14', null]);
    const band = s.byAge.bands[0];
    expect(band).toMatchObject({ readers: 1, borrowings: 3 });
    expect(band.categories[0]).toEqual({ key: 'Stories', count: 2 });
    expect(band.topBooks[0]).toEqual({ title: 'Kalila', count: 2 });
    expect(s.byAge.bands[1]).toMatchObject({ readers: 1, borrowings: 1 });
  });

  it('club: per stage readers now, progress, days in stage, completed, completion rate and what is read', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    const club = s.club!;
    expect(club).toMatchObject({ members: 2, completions: 2, pendingRewards: 1, presents: 1 });
    expect(club.completionsByMonth).toEqual([{ month: '2026-08', count: 1 }, { month: '2026-09', count: 1 }]);

    const [bronze, silver] = club.groups[0].stages;
    // Bronze (pages, target 200): Aisha has 40+60 pages of entries + 20 manual = 120 -> 60%
    expect(bronze).toMatchObject({ readersNow: 1, avgProgressPct: 60, completed: 2, completionRate: 66.7 });
    expect(bronze.avgDaysInStage).toBe(43.5); // 2026-09-01 00:00 -> 2026-10-14 12:00
    expect(bronze.categories).toEqual([{ key: 'Science', count: 1 }, { key: 'Stories', count: 1 }, { key: null, count: 1 }].sort((a, b) => b.count - a.count || (a.key ?? '￿').localeCompare(b.key ?? '￿')));
    // Silver (books, target 5): Omar started 09-30, no returned loans of his in the mock -> 0%
    expect(silver).toMatchObject({ readersNow: 1, avgProgressPct: 0, completed: 0, completionRate: 0 });

    expect(club.topReaders[0]).toMatchObject({ code: 'R1', completions: 1, booksRead: 3 });
    expect(club.topReaders.map((r) => r.code)).toContain('R3'); // completed a stage in the period
  });

  it('the period limits borrowings, completions and club entries', async () => {
    const s = await ctx.service.getStatistics({ from: '2026-09-11', to: '2026-09-30' }, NOW);
    expect(s.club!.completions).toBe(1); // only the 09-15 one
    expect(s.club!.presents).toBe(1);
    expect(s.club!.groups[0].stages[0].categories.map((c) => c.count).reduce((a, b) => a + b, 0)).toBe(2); // 09-11 and 09-12 entries
    expect(s.period).toEqual({ from: '2026-09-11', to: '2026-09-30' });
  });

  it('rejects a period whose start is after its end', async () => {
    await expect(ctx.service.getStatistics({ from: '2026-10-02', to: '2026-10-01' }, NOW)).rejects.toThrow(/period start/);
  });

  it('club is null when there is no episode', async () => {
    const { service } = build(null);
    expect((await service.getStatistics({}, NOW)).club).toBeNull();
  });
});
