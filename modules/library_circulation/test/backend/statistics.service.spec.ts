import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { StatisticsService, ageInYears, tally } from '../../backend/statistics.service';

const NOW = new Date('2026-10-14T12:00:00Z');
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('helpers', () => {
  it('tally counts, sorts by count then name, blank as null', () => {
    const result = tally(['Story', 'Science', 'Story', null, ' ', 'Art']);
    expect(result[0]).toEqual({ key: 'Story', count: 2 });
    expect(result.find((e) => e.key === null)).toEqual({ key: null, count: 2 });
  });
  it('ageInYears is whole years', () => {
    expect(ageInYears(d('2016-10-14'), NOW)).toBe(10);
    expect(ageInYears(d('2016-10-15'), NOW)).toBe(9);
  });
});

function build() {
  const prisma = {
    userRole: { findMany: jest.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]) },
    libraryStudent: {
      findMany: jest.fn(async () => [
        { id: 's1', userId: 'u1', code: 'R1', className: '5A', createdAt: d('2026-09-20') }, // 10y
        { id: 's2', userId: 'u2', code: 'R2', className: '5A', createdAt: d('2025-01-01') }, // no dob, never borrows
        { id: 's3', userId: 'u3', code: 'R3', className: '6B', createdAt: d('2025-01-01') }, // 13y, overdue
      ]),
    },
    user: {
      findMany: jest.fn(async () => [
        { id: 'u1', name: 'Aisha', isActive: true, dateOfBirth: d('2016-03-01') },
        { id: 'u2', name: 'Omar', isActive: true, dateOfBirth: null },
        { id: 'u3', name: 'Zed', isActive: true, dateOfBirth: d('2013-05-05') },
      ]),
    },
    libraryBorrowing: {
      findMany: jest.fn(async (args: { where?: { returnedAt?: unknown; borrowedAt?: unknown }; distinct?: string[] }) => {
        if (args.distinct) return [{ bookCopyId: 'c1' }, { bookCopyId: 'c2' }]; // ever borrowed
        if (args.where && 'returnedAt' in args.where && args.where.returnedAt === null)
          return [{ studentId: 's3', bookCopyId: 'c2', dueAt: daysBefore(10), status: 'overdue' }, { studentId: 's1', bookCopyId: 'c1', dueAt: daysBefore(-5), status: 'active' }]; // open loans
        if (args.where && 'returnedAt' in args.where)
          return [
            { borrowedAt: daysBefore(20), dueAt: daysBefore(6), returnedAt: daysBefore(5), returnStatus: null }, // 1 day late, 15 days loan
            { borrowedAt: daysBefore(12), dueAt: daysBefore(2), returnedAt: daysBefore(2), returnStatus: 'damaged' }, // on time
          ];
        return [
          { studentId: 's1', bookCopyId: 'c1', status: 'returned', borrowedAt: d('2026-09-01') },
          { studentId: 's1', bookCopyId: 'c1', status: 'returned', borrowedAt: d('2026-09-08') },
          { studentId: 's1', bookCopyId: 'c1', status: 'active', borrowedAt: d('2026-10-12') }, // 2026-10-12 is a Monday
          { studentId: 's3', bookCopyId: 'c2', status: 'overdue', borrowedAt: daysBefore(20) },
        ];
      }),
    },
    libraryCatalogBookCopy: {
      findMany: jest.fn(async () => [
        { id: 'c1', bookId: 'b1', status: 'borrowed' },
        { id: 'c2', bookId: 'b2', status: 'available' },
        { id: 'c3', bookId: 'b3', status: 'available' },
        { id: 'c4', bookId: 'b3', status: 'damaged' },
      ]),
    },
    libraryCatalogBook: {
      findMany: jest.fn(async () => [
        { id: 'b1', title: 'Kalila', author: 'A', category: 'Stories', readingLevel: 'L1', createdAt: d('2025-01-01') },
        { id: 'b2', title: 'Atlas', author: 'B', category: 'Science', readingLevel: 'L2', createdAt: d('2025-01-01') },
        { id: 'b3', title: 'Dusty', author: null, category: null, readingLevel: null, createdAt: d('2020-01-01') }, // never borrowed
      ]),
    },
    libraryCatalogBookRating: {
      groupBy: jest.fn(async () => [
        { bookId: 'b1', _avg: { rating: 4.5 }, _count: { _all: 4 } },
        { bookId: 'b2', _avg: { rating: 5 }, _count: { _all: 1 } },
      ]),
    },
    libraryFine: {
      findMany: jest.fn(async (args: { where?: { status?: unknown } }) =>
        args.where?.status
          ? [{ amount: 10, amountPaid: 4 }, { amount: 5, amountPaid: 0 }] // all open fines -> 11 outstanding
          : [
              { amount: 10, amountPaid: 4, status: 'partially_paid', fineTypeId: 'ft1' },
              { amount: 5, amountPaid: 5, status: 'paid', fineTypeId: 'ft2' },
              { amount: 7.5, amountPaid: 0, status: 'unpaid', fineTypeId: 'ft1' },
            ],
      ),
    },
    libraryFineType: { findMany: jest.fn(async () => [{ id: 'ft1', name: 'Late' }, { id: 'ft2', name: 'Damage' }]) },
  };
  const service = new StatisticsService();
  (service as unknown as { prisma: unknown }).prisma = prisma;
  return { service, prisma };
}

describe('library StatisticsService', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('readers: total, active, without date of birth, new in the period', async () => {
    const s = await ctx.service.getStatistics({ from: '2026-09-01', to: '2026-10-31' }, NOW);
    expect(s.readers).toEqual({ total: 3, active: 3, withoutDateOfBirth: 1, newInPeriod: 1 });
  });

  it('activity: totals, rates and the time series', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.activity).toMatchObject({ borrowings: 4, returns: 2, onLoanNow: 2, overdueNow: 1, borrowers: 2 });
    expect(s.activity.borrowerRatePct).toBe(66.7); // 2 of 3 active readers
    expect(s.activity.onTimeRatePct).toBe(50);
    expect(s.activity.avgDaysLate).toBe(1);
    expect(s.activity.avgLoanDays).toBe(12.5); // (15 + 10) / 2
    expect(s.activity.byMonth.map((m) => m.month)).toEqual([...new Set(s.activity.byMonth.map((m) => m.month))].sort());
    expect(s.activity.byWeekday.find((w) => w.weekday === 1)?.count).toBe(1); // the Monday borrowing
    expect(s.activity.byWeekday).toHaveLength(7);
  });

  it('collection: copies by status, never-borrowed titles (oldest first)', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.collection).toMatchObject({ titles: 3, copies: 4 });
    expect(s.collection.copiesByStatus.find((c) => c.key === 'available')?.count).toBe(2);
    expect(s.collection.neverBorrowed.count).toBe(1);
    expect(s.collection.neverBorrowed.sample[0]).toMatchObject({ title: 'Dusty', copies: 2 });
  });

  it('overdue: age buckets and the readers with the longest overdue books', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.overdue.buckets).toEqual([
      { key: '1-7', count: 0 },
      { key: '8-14', count: 1 },
      { key: '15-30', count: 0 },
      { key: '31+', count: 0 },
    ]);
    expect(s.overdue.readers[0]).toMatchObject({ code: 'R3', books: 1, maxDaysLate: 10 });
  });

  it('return conditions treat a blank status as a normal return', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.returnConditions).toEqual([{ key: 'damaged', count: 1 }, { key: 'returned', count: 1 }]);
  });

  it('books: top borrowed, rated (min ratings applied), demand per copy', async () => {
    const s = await ctx.service.getStatistics({ minRatings: 2 }, NOW);
    expect(s.books.topBooks[0]).toMatchObject({ title: 'Kalila', count: 3 });
    expect(s.books.topRated.map((b) => b.title)).toEqual(['Kalila']); // Atlas has only 1 rating
    expect(s.books.highDemand[0]).toMatchObject({ title: 'Kalila', borrowings: 3, copies: 1, perCopy: 3 });
    expect(s.books.categories[0]).toEqual({ key: 'Stories', count: 3 });
  });

  it('readers activity: top borrowers, inactive readers, borrowing per class', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.readersActivity.topReaders[0]).toMatchObject({ code: 'R1', borrowings: 3 });
    expect(s.readersActivity.inactive).toMatchObject({ count: 1 });
    expect(s.readersActivity.inactive.sample[0].code).toBe('R2');
    expect(s.readersActivity.byClass.find((c) => c.className === '5A')).toEqual({ className: '5A', readers: 2, borrowings: 3, perReader: 1.5 });
  });

  it('fines: issued / paid / outstanding (all open) and by type', async () => {
    const s = await ctx.service.getStatistics({}, NOW);
    expect(s.fines).toMatchObject({ issuedCount: 3, issuedAmount: 22.5, paidAmount: 9, outstandingAmount: 11 });
    expect(s.fines.byType).toEqual([{ name: 'Late', count: 2, amount: 17.5 }, { name: 'Damage', count: 1, amount: 5 }]);
    expect(s.fines.byStatus[0].count).toBe(1);
  });

  it('age groups: bands of the chosen width, unknown last', async () => {
    const s = await ctx.service.getStatistics({ ageBandYears: 5 }, NOW);
    expect(s.byAge.bands.map((b) => b.label)).toEqual(['10-14', null]);
    expect(s.byAge.bands[0]).toMatchObject({ readers: 2, borrowings: 4 }); // Aisha 10 + Zed 13
    expect(s.byAge.bands[1]).toMatchObject({ readers: 1, borrowings: 0 });
  });

  it('rejects a period whose start is after its end', async () => {
    await expect(ctx.service.getStatistics({ from: '2026-10-02', to: '2026-10-01' }, NOW)).rejects.toThrow(/period start/);
  });
});
