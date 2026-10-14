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
    userRole: { findMany: jest.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }]) },
    libraryStudent: {
      findMany: jest.fn(async () => [
        { id: 's1', userId: 'u1', code: 'R1', className: '5A' }, // member, 10y
        { id: 's2', userId: 'u2', code: 'R2', className: '6B' }, // member, no dob
        { id: 's3', userId: 'u3', code: 'R3', className: '5A' }, // inactive
        { id: 's4', userId: 'u4', code: 'R4', className: '5A' }, // active non-member
      ]),
    },
    user: {
      findMany: jest.fn(async () => [
        { id: 'u1', name: 'Aisha', isActive: true, dateOfBirth: d('2016-03-01') },
        { id: 'u2', name: 'Omar', isActive: true, dateOfBirth: null },
        { id: 'u3', name: 'Zed', isActive: false, dateOfBirth: d('2015-01-01') },
        { id: 'u4', name: 'Lina', isActive: true, dateOfBirth: d('2014-01-01') },
      ]),
    },
    libraryBorrowing: {
      findMany: jest.fn(async (args: { where?: { status?: unknown; studentId?: unknown } }) => {
        if (args.where?.status === 'returned') return [{ studentId: 's1', returnedAt: d('2026-10-01') }, { studentId: 's1', returnedAt: d('2026-10-05') }];
        if (args.where?.status) return [{ studentId: 's1' }]; // open loans (visibility)
        return [{ studentId: 's1' }, { studentId: 's1' }, { studentId: 's1' }, { studentId: 's2' }, { studentId: 's4' }]; // period borrowings
      }),
    },
    readingClubEpisode: {
      findUnique: jest.fn(async () => currentEpisode),
      findMany: jest.fn(async () => [
        { id: 'ep1', name: 'Season 1', isCurrent: true },
        { id: 'ep0', name: 'Season 0', isCurrent: false },
      ]),
    },
    readingClubGroup: {
      groupBy: jest.fn(async () => [{ episodeId: 'ep1', _count: { _all: 1 } }, { episodeId: 'ep0', _count: { _all: 2 } }]),
      findMany: jest.fn(async () => [
        { id: 'g1', name: 'Eagles', stages: [
          { id: 'st1', stageOrder: 1, name: 'Bronze', targetType: 'pages', targetAmount: 200 },
          { id: 'st2', stageOrder: 2, name: 'Silver', targetType: 'books', targetAmount: 5 },
        ] },
      ]),
    },
    readingClubMembership: {
      findMany: jest.fn(async () => [
        { studentId: 's1', groupId: 'g1', groupName: 'Eagles', currentStageId: 'st1', stageName: 'Bronze', stageStartedAt: d('2026-09-01'), manualProgressAmount: 20 },
        { studentId: 's2', groupId: 'g1', groupName: 'Eagles', currentStageId: 'st2', stageName: 'Silver', stageStartedAt: d('2026-09-30'), manualProgressAmount: 0 },
        { studentId: 's5', groupId: 'g1', groupName: 'Eagles', currentStageId: null, stageName: null, stageStartedAt: d('2026-05-01'), manualProgressAmount: 0 }, // finished every stage
      ]),
    },
    readingClubStageCompletion: {
      findMany: jest.fn(async () => [
        { studentId: 's1', episodeId: 'ep1', groupId: 'g1', stageId: 'st1', completedAt: d('2026-08-15'), rewardStatus: 'pending', rewardDeliveredAt: null },
        { studentId: 's3', episodeId: 'ep1', groupId: 'g1', stageId: 'st1', completedAt: d('2026-09-15'), rewardStatus: 'delivered', rewardDeliveredAt: d('2026-09-18') },
        { studentId: 's1', episodeId: 'ep0', groupId: null, stageId: null, completedAt: d('2025-12-01'), rewardStatus: 'delivered', rewardDeliveredAt: d('2025-12-02') },
      ]),
    },
    readingClubPresent: { findMany: jest.fn(async () => [{ givenAt: d('2026-09-16') }]) },
    readingClubStageBookEntry: {
      findMany: jest.fn(async () => [
        { studentId: 's1', episodeId: 'ep1', groupId: 'g1', stageId: 'st1', bookCopyId: 'c1', pageCount: 40, addedAt: d('2026-09-02') },
        { studentId: 's1', episodeId: 'ep1', groupId: 'g1', stageId: 'st1', bookCopyId: 'c2', pageCount: 60, addedAt: d('2026-09-11') },
        { studentId: 's1', episodeId: 'ep1', groupId: 'g1', stageId: 'st1', bookCopyId: null, pageCount: null, addedAt: d('2026-09-12') },
      ]),
    },
    libraryCatalogBookCopy: { findMany: jest.fn(async () => [{ id: 'c1', bookId: 'b1' }, { id: 'c2', bookId: 'b2' }]) },
    libraryCatalogBook: {
      findMany: jest.fn(async () => [
        { id: 'b1', category: 'Stories', readingLevel: 'L1' },
        { id: 'b2', category: 'Science', readingLevel: 'L2' },
      ]),
    },
  };
  const episodes = { findCurrentEpisodeOrNull: jest.fn(async () => currentEpisode) };
  const service = new StatisticsService(episodes as never);
  (service as unknown as { prisma: unknown }).prisma = prisma;
  return { service, prisma };
}

describe('club StatisticsService.getStatistics', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('participation: members vs active readers, finished-all, and borrowing of members vs others', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.episode).toMatchObject({ id: 'ep1', name: 'Season 1' });
    // visible readers: s1..s4 (all hold the reader role); active = s1,s2,s4. s5 is not a visible reader.
    expect(s.participation).toMatchObject({ activeReaders: 3, members: 3, finishedAllStages: 1 });
    expect(s.participation.participationPct).toBe(66.7); // active members s1,s2 of 3
    // member loans: s1 x3 + s2 x1 = 4 over 2 members; non-member s4 x1 over 1
    expect(s.participation.borrowingsPerMember).toBe(2);
    expect(s.participation.borrowingsPerNonMember).toBe(1);
  });

  it('achievements and the reward pipeline', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.achievements).toMatchObject({ completions: 2, presents: 1 });
    expect(s.achievements.completionsByMonth).toEqual([{ month: '2026-08', count: 1 }, { month: '2026-09', count: 1 }]);
    expect(s.rewards.pending).toBe(1);
    expect(s.rewards.oldestPendingDays).toBe(60); // 2026-08-15 -> 2026-10-14
    expect(s.rewards.avgDaysToDeliver).toBe(3);
  });

  it('per stage: readers now, progress, days in stage, completed, completion rate and what is read', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    const [bronze, silver] = s.groups[0].stages;
    expect(bronze).toMatchObject({ readersNow: 1, avgProgressPct: 60, completed: 2, completionRate: 66.7 }); // 40+60 pages + 20 manual of 200
    expect(bronze.avgDaysInStage).toBe(43.5);
    expect(bronze.categories.map((c) => c.key).sort()).toEqual(['Science', 'Stories', null].sort((a, b) => (a ?? '\uffff').localeCompare(b ?? '\uffff')));
    expect(silver).toMatchObject({ readersNow: 1, avgProgressPct: 0, completed: 0, completionRate: 0 });
    expect(s.categories.find((c) => c.key === 'Stories')?.count).toBe(1);
  });

  it('top readers and the members longest in their stage', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.topReaders[0]).toMatchObject({ code: 'R1', completions: 1, booksRead: 3 });
    expect(s.stalled[0]).toMatchObject({ code: 'R1', stageName: 'Bronze', progressPct: 60 });
    expect(s.stalled[0].daysInStage).toBe(43);
    expect(s.stalled.map((m) => m.code)).toEqual(['R1', 'R2']); // longest first; the finished member is not listed
  });

  it('age groups: club members and achievements per band', async () => {
    const s = await ctx.service.getStatistics({ ageBandYears: 5 }, NOW);
    expect(s.byAge.bands.map((b) => b.label)).toEqual(['10-14', null]);
    expect(s.byAge.bands[0]).toMatchObject({ members: 1, completions: 1 });
  });

  it('seasons compared', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.episodes).toEqual([
      { id: 'ep1', name: 'Season 1', isCurrent: true, groups: 1, completions: 2, readersWithCompletion: 2 },
      { id: 'ep0', name: 'Season 0', isCurrent: false, groups: 2, completions: 1, readersWithCompletion: 1 },
    ]);
  });

  it('the period limits completions, presents and club entries', async () => {
    const s = await ctx.service.getStatistics({ from: '2026-09-11', to: '2026-09-30' }, NOW);
    expect(s.achievements.completions).toBe(1);
    expect(s.groups[0].stages[0].categories.map((c) => c.count).reduce((a, b) => a + b, 0)).toBe(2);
    expect(s.period).toEqual({ from: '2026-09-11', to: '2026-09-30' });
  });

  it('rejects a period whose start is after its end', async () => {
    await expect(ctx.service.getStatistics({ from: '2026-10-02', to: '2026-10-01' }, NOW)).rejects.toThrow(/period start/);
  });

  it('no episode: empty club figures, seasons still listed', async () => {
    const { service } = build(null);
    const s = await service.getStatistics({}, NOW);
    expect(s.episode).toBeNull();
    expect(s.groups).toEqual([]);
    expect(s.participation.members).toBe(0);
    expect(s.episodes).toHaveLength(2);
  });
});
