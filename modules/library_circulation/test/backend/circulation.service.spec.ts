import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CirculationService } from '../../backend/circulation.service';

interface MockPrisma {
  libraryStudent: { findUnique: jest.Mock; findMany: jest.Mock };
  libraryCatalogBookCopy: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; count: jest.Mock };
  libraryCatalogBook: { findUnique: jest.Mock; findMany: jest.Mock };
  libraryBorrowing: { count: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
  user: { findUnique: jest.Mock; findMany: jest.Mock };
  userRole: { count: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    libraryStudent: { findUnique: jest.fn(), findMany: jest.fn() },
    libraryCatalogBookCopy: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    libraryCatalogBook: { findUnique: jest.fn(), findMany: jest.fn() },
    libraryBorrowing: { count: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    userRole: { count: jest.fn(async () => 1) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: MockPrisma) => unknown) => cb(prisma));
  return prisma;
}

function buildService(
  prisma: MockPrisma,
  loanPolicy: { getLoanPolicy: jest.Mock },
  notifications: { send: jest.Mock } = { send: jest.fn() },
): CirculationService {
  const service = new CirculationService(loanPolicy as never, notifications as never);
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

const POLICY = { maxBooksPerStudent: 3, loanPeriodDays: 14, finePerDay: 1 };

function studentRow(overrides: Record<string, unknown> = {}) {
  return { id: 'student-1', userId: 'user-1', code: 'STU-001', className: '5A', academicYearId: null, ...overrides };
}

function copyRow(overrides: Record<string, unknown> = {}) {
  return { id: 'copy-1', bookId: 'book-1', qrCode: 'BOOK-001', status: 'available', ...overrides };
}

describe('CirculationService', () => {
  let prisma: MockPrisma;
  let settings: { getLoanPolicy: jest.Mock };
  let service: CirculationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    settings = { getLoanPolicy: jest.fn().mockResolvedValue(POLICY) };
    service = buildService(prisma, settings);
  });

  describe('scan', () => {
    it('resolves a STU-prefixed code to a student', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.user.findUnique.mockResolvedValue({ name: 'Aisha', email: 'a@b.test' });
      prisma.libraryBorrowing.count.mockResolvedValue(1);

      const result = await service.scan('STU-001');
      expect(result.type).toBe('student');
    });

    it('resolves a BOOK-prefixed code to a book copy', async () => {
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1', title: 'Kalila wa Dimna' });
      prisma.libraryBorrowing.findFirst.mockResolvedValue(null);

      const result = await service.scan('BOOK-001');
      expect(result.type).toBe('book_copy');
    });

    it('falls back to trying both tables for a code with no recognized prefix', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValueOnce(null); // scan()'s own fallback probe
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValueOnce(copyRow()); // found as a book copy
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1', title: 'X' });
      prisma.libraryBorrowing.findFirst.mockResolvedValue(null);
      // scanBookCopy() re-fetches the copy itself.
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());

      const result = await service.scan('XYZ-999');
      expect(result.type).toBe('book_copy');
    });

    it('returns a not_found result (not a 404) when the code matches nothing at all', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);
      expect(await service.scan('NOPE')).toEqual({ type: 'not_found', code: 'NOPE' });
    });

    it('a reader-style code with no profile is also a not_found result', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      expect(await service.scan('R000999')).toEqual({ type: 'not_found', code: 'R000999' });
    });
  });

  describe('borrow', () => {
    it('§7: creates a borrowing with due date = today + loanPeriodDays and marks the copy borrowed', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
      prisma.libraryBorrowing.count.mockResolvedValue(0);
      prisma.libraryBorrowing.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: 'borrowing-1',
        ...data,
      }));

      const borrowing = await service.borrow('student-1', 'copy-1', 'staff-1');

      expect(prisma.libraryCatalogBookCopy.update).toHaveBeenCalledWith({ where: { id: 'copy-1' }, data: { status: 'borrowed' } });
      const dueAt = (borrowing as unknown as { dueAt: Date }).dueAt;
      const expectedMs = Date.now() + POLICY.loanPeriodDays * 24 * 60 * 60 * 1000;
      expect(Math.abs(dueAt.getTime() - expectedMs)).toBeLessThan(5000);
    });

    it('rejects a new borrowing for an account whose reader role was revoked', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
      prisma.userRole.count.mockResolvedValueOnce(0);

      await expect(service.borrow('student-1', 'copy-1', 'staff-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryBorrowing.create).not.toHaveBeenCalled();
    });

    it('§22: rejects borrowing an already-borrowed copy', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow({ status: 'borrowed' }));

      await expect(service.borrow('student-1', 'copy-1', 'staff-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryBorrowing.create).not.toHaveBeenCalled();
    });

    it('§22/§8: rejects once the student is at the policy borrowing limit', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
      prisma.libraryBorrowing.count.mockResolvedValue(POLICY.maxBooksPerStudent);

      await expect(service.borrow('student-1', 'copy-1', 'staff-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryBorrowing.create).not.toHaveBeenCalled();
    });

    it('404s for a nonexistent student or copy', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
      await expect(service.borrow('missing', 'copy-1', 'staff-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('Feature 5.1: accepts and stores optional comments', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
      prisma.libraryBorrowing.count.mockResolvedValue(0);
      prisma.libraryBorrowing.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: 'borrowing-1',
        ...data,
      }));

      const comments = 'Return by end of semester';
      const borrowing = await service.borrow('student-1', 'copy-1', 'staff-1', undefined, comments);

      expect((borrowing as unknown as { comments: string }).comments).toBe(comments);
    });

    it('Feature 5.1: allows overriding the expected return date (due date)', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
      prisma.libraryBorrowing.count.mockResolvedValue(0);
      prisma.libraryBorrowing.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: 'borrowing-1',
        ...data,
      }));

      const customDueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const borrowing = await service.borrow('student-1', 'copy-1', 'staff-1', customDueDate);

      expect((borrowing as unknown as { dueAt: Date }).dueAt.getTime()).toBe(customDueDate.getTime());
    });
  });

  describe('returnBorrowing', () => {
    it('returns on time (daysLate: 0) when returned before the due date', async () => {
      const dueAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      prisma.libraryBorrowing.findUnique.mockResolvedValue({ id: 'b-1', status: 'active', dueAt, bookCopyId: 'copy-1', studentId: 'student-1' });
      prisma.libraryBorrowing.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'b-1', ...data }));

      const { daysLate } = await service.returnBorrowing('b-1', 'staff-1');
      expect(daysLate).toBe(0);
      expect(prisma.libraryCatalogBookCopy.update).toHaveBeenCalledWith({ where: { id: 'copy-1' }, data: { status: 'available' } });
    });

    it('§8/§9: computes positive daysLate when returned after the due date', async () => {
      const dueAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000); // just over 3 days ago
      prisma.libraryBorrowing.findUnique.mockResolvedValue({ id: 'b-1', status: 'active', dueAt, bookCopyId: 'copy-1', studentId: 'student-1' });
      prisma.libraryBorrowing.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'b-1', ...data }));

      const { daysLate } = await service.returnBorrowing('b-1', 'staff-1');
      expect(daysLate).toBeGreaterThanOrEqual(3);
    });

    it('§22: rejects returning a borrowing that is already returned', async () => {
      prisma.libraryBorrowing.findUnique.mockResolvedValue({ id: 'b-1', status: 'returned', dueAt: new Date(), bookCopyId: 'copy-1' });
      await expect(service.returnBorrowing('b-1', 'staff-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s for a nonexistent borrowing', async () => {
      prisma.libraryBorrowing.findUnique.mockResolvedValue(null);
      await expect(service.returnBorrowing('missing', 'staff-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('backdating: an explicit returnedAtOverride is used for both the stored returnedAt and the daysLate calculation, not "now"', async () => {
      const dueAt = new Date('2026-01-01T00:00:00Z');
      const backdated = new Date('2026-01-04T00:00:00Z'); // 3 days late as of the backdated date
      prisma.libraryBorrowing.findUnique.mockResolvedValue({ id: 'b-1', status: 'active', dueAt, bookCopyId: 'copy-1', studentId: 'student-1' });
      prisma.libraryBorrowing.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'b-1', ...data }));

      const { daysLate, borrowing } = await service.returnBorrowing('b-1', 'staff-1', undefined, undefined, backdated);

      expect(daysLate).toBe(3);
      expect((borrowing as { returnedAt: Date }).returnedAt).toEqual(backdated);
    });
  });

  describe('extendLoan', () => {
    it('extends an active borrowing to a staff-picked new due date', async () => {
      const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      prisma.libraryBorrowing.findUnique.mockResolvedValue({ id: 'b-1', status: 'active', dueAt, studentId: 'student-1' });
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      const newDueDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
      prisma.libraryBorrowing.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'b-1', ...data }));

      const updated = await service.extendLoan('b-1', newDueDate);

      expect(prisma.libraryBorrowing.update).toHaveBeenCalledWith({ where: { id: 'b-1' }, data: { dueAt: newDueDate } });
      expect((updated as unknown as { dueAt: Date }).dueAt).toBe(newDueDate);
    });

    it('rejects a new due date that is not after the current due date', async () => {
      const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      prisma.libraryBorrowing.findUnique.mockResolvedValue({ id: 'b-1', status: 'active', dueAt, studentId: 'student-1' });

      await expect(service.extendLoan('b-1', dueAt)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryBorrowing.update).not.toHaveBeenCalled();
    });

    it('rejects extending a borrowing that is already returned', async () => {
      const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      prisma.libraryBorrowing.findUnique.mockResolvedValue({ id: 'b-1', status: 'returned', dueAt, studentId: 'student-1' });

      await expect(service.extendLoan('b-1', new Date(Date.now() + 21 * 24 * 60 * 60 * 1000))).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryBorrowing.update).not.toHaveBeenCalled();
    });

    it('404s for a nonexistent borrowing', async () => {
      prisma.libraryBorrowing.findUnique.mockResolvedValue(null);
      await expect(service.extendLoan('missing', new Date(Date.now() + 21 * 24 * 60 * 60 * 1000))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findActiveBorrowingForCopy', () => {
    it('404s when the copy has no active borrowing (nothing to return)', async () => {
      prisma.libraryBorrowing.findFirst.mockResolvedValue(null);
      await expect(service.findActiveBorrowingForCopy('copy-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getCirculationHistory', () => {
    it('Feature 2.2: returns borrowing history for a copy, ordered by date descending', async () => {
      const borrowings = [
        {
          id: 'b-1',
          studentId: 'student-1',
          student: { code: 'STU-001', userId: 'user-1' },
          bookCopyId: 'copy-1',
          borrowedAt: new Date('2026-09-01'),
          dueAt: new Date('2026-09-15'),
          returnedAt: new Date('2026-09-12'),
          status: 'returned',
          comments: null,
          borrowedBy: 'staff-1',
          returnedBy: 'staff-2',
        },
        {
          id: 'b-2',
          studentId: 'student-2',
          student: { code: 'STU-002', userId: 'user-2' },
          bookCopyId: 'copy-1',
          borrowedAt: new Date('2026-09-10'),
          dueAt: new Date('2026-09-24'),
          returnedAt: null,
          status: 'active',
          comments: 'Keep longer if possible',
          borrowedBy: 'staff-1',
          returnedBy: null,
        },
      ];
      prisma.libraryBorrowing.findMany.mockResolvedValue(borrowings);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Aisha' }]);

      const result = await service.getCirculationHistory('copy-1');

      expect(prisma.libraryBorrowing.findMany).toHaveBeenCalledWith({
        where: { bookCopyId: 'copy-1' },
        orderBy: { borrowedAt: 'desc' },
        take: 10,
        include: { student: true },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('studentCode', 'STU-001');
      expect(result[0]).toHaveProperty('studentName', 'Aisha');
      expect(result[1]).toHaveProperty('studentName', null);
    });

    it('respects the limit parameter when fetching history', async () => {
      prisma.libraryBorrowing.findMany.mockResolvedValue([]);

      await service.getCirculationHistory('copy-1', undefined, 5);

      expect(prisma.libraryBorrowing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('getBookCirculationHistory (§2.1)', () => {
    it('resolves the book\'s copy ids first, then queries borrowings across all of them', async () => {
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([
        { id: 'copy-1', qrCode: 'BOOK-001' },
        { id: 'copy-2', qrCode: 'BOOK-002' },
      ]);
      prisma.libraryBorrowing.findMany.mockResolvedValue([
        {
          id: 'b-1',
          studentId: 'student-1',
          student: { code: 'STU-001', userId: 'user-1' },
          bookCopyId: 'copy-1',
          borrowedAt: new Date('2026-09-01'),
          dueAt: new Date('2026-09-15'),
          returnedAt: new Date('2026-09-12'),
          status: 'returned',
        },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Ahmed' }]);

      const result = await service.getBookCirculationHistory('book-1');

      expect(prisma.libraryCatalogBookCopy.findMany).toHaveBeenCalledWith({
        where: { bookId: 'book-1' },
        select: { id: true, qrCode: true },
      });
      expect(prisma.libraryBorrowing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { bookCopyId: { in: ['copy-1', 'copy-2'] } } }),
      );
      expect(result).toEqual([
        expect.objectContaining({ id: 'b-1', studentCode: 'STU-001', studentName: 'Ahmed', qrCode: 'BOOK-001' }),
      ]);
    });

    it('returns an empty array without querying borrowings when the book has no copies', async () => {
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([]);

      const result = await service.getBookCirculationHistory('book-1');

      expect(result).toEqual([]);
      expect(prisma.libraryBorrowing.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getCopyStats', () => {
    it('§18: returns real aggregate counts for the dashboard, never mock numbers', async () => {
      prisma.libraryCatalogBookCopy.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(60) // available
        .mockResolvedValueOnce(40); // borrowed
      prisma.libraryBorrowing.count.mockResolvedValue(5); // overdue

      const stats = await service.getCopyStats();
      expect(stats).toEqual({ totalCopies: 100, availableCopies: 60, borrowedCopies: 40, overdueBorrowings: 5 });
    });
  });

  describe('getActiveBorrowingsForStudent', () => {
    it('enriches each active borrowing with its book title/qrCode and flags overdue ones', async () => {
      const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const futureDue = new Date(Date.now() + 24 * 60 * 60 * 1000);
      prisma.libraryBorrowing.findMany.mockResolvedValue([
        { id: 'b-1', bookCopyId: 'copy-1', borrowedAt: new Date(), dueAt: pastDue, status: 'overdue' },
        { id: 'b-2', bookCopyId: 'copy-2', borrowedAt: new Date(), dueAt: futureDue, status: 'active' },
      ]);
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([
        { id: 'copy-1', bookId: 'book-1', qrCode: 'BOOK-001' },
        { id: 'copy-2', bookId: 'book-2', qrCode: 'BOOK-002' },
      ]);
      prisma.libraryCatalogBook.findMany.mockResolvedValue([
        { id: 'book-1', title: 'Kalila wa Dimna' },
        { id: 'book-2', title: 'The Little Prince' },
      ]);

      const result = await service.getActiveBorrowingsForStudent('student-1');

      expect(result[0]).toMatchObject({ id: 'b-1', bookTitle: 'Kalila wa Dimna', qrCode: 'BOOK-001', isOverdue: true });
      expect(result[1]).toMatchObject({ id: 'b-2', bookTitle: 'The Little Prince', qrCode: 'BOOK-002', isOverdue: false });
    });

    it('returns [] without querying copies/books when the reader has no active borrowings', async () => {
      prisma.libraryBorrowing.findMany.mockResolvedValue([]);

      const result = await service.getActiveBorrowingsForStudent('student-1');

      expect(result).toEqual([]);
      expect(prisma.libraryCatalogBookCopy.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listBorrowings (Borrowings status page, user request)', () => {
    const borrowedAt = new Date('2026-01-01T00:00:00Z');
    const pastDueAt = new Date('2026-01-05T00:00:00Z'); // definitely in the past relative to "now" in this test run
    const futureDueAt = new Date('2099-01-01T00:00:00Z');

    it('enriches each row with book title/copy code and reader code/name', async () => {
      prisma.libraryBorrowing.findMany.mockResolvedValue([
        { id: 'b-1', bookCopyId: 'copy-1', studentId: 'student-1', status: 'active', borrowedAt, dueAt: futureDueAt, returnedAt: null },
      ]);
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([copyRow({ id: 'copy-1', qrCode: 'BOOK-001' })]);
      prisma.libraryCatalogBook.findMany.mockResolvedValue([{ id: 'book-1', title: 'Kalila wa Dimna' }]);
      prisma.libraryStudent.findMany.mockResolvedValue([studentRow({ id: 'student-1', userId: 'user-1', code: 'STU-001' })]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Omar' }]);

      const result = await service.listBorrowings({});

      expect(result).toEqual([
        expect.objectContaining({
          id: 'b-1',
          bookTitle: 'Kalila wa Dimna',
          qrCode: 'BOOK-001',
          studentCode: 'STU-001',
          studentName: 'Omar',
          status: 'active',
          daysOverdue: 0,
        }),
      ]);
    });

    it('computes daysOverdue only for a still-active borrowing past its dueAt — never for an already-returned one', async () => {
      prisma.libraryBorrowing.findMany.mockResolvedValue([
        { id: 'b-overdue', bookCopyId: 'copy-1', studentId: 'student-1', status: 'active', borrowedAt, dueAt: pastDueAt, returnedAt: null },
        { id: 'b-returned-late', bookCopyId: 'copy-1', studentId: 'student-1', status: 'returned', borrowedAt, dueAt: pastDueAt, returnedAt: new Date('2026-01-10') },
      ]);
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([copyRow({ id: 'copy-1' })]);
      prisma.libraryCatalogBook.findMany.mockResolvedValue([{ id: 'book-1', title: 'Kalila wa Dimna' }]);
      prisma.libraryStudent.findMany.mockResolvedValue([studentRow({ id: 'student-1', userId: 'user-1' })]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Omar' }]);

      const result = await service.listBorrowings({});

      const overdueRow = result.find((r) => r.id === 'b-overdue');
      const returnedRow = result.find((r) => r.id === 'b-returned-late');
      expect(overdueRow?.daysOverdue).toBeGreaterThan(0);
      expect(returnedRow?.daysOverdue).toBe(0);
    });

    it('overdueOnly filters to active+overdue statuses with dueAt < now, never a literal "overdue" status match', async () => {
      prisma.libraryBorrowing.findMany.mockResolvedValue([]);

      await service.listBorrowings({ overdueOnly: true });

      expect(prisma.libraryBorrowing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['active', 'overdue'] },
            dueAt: { lt: expect.any(Date) },
          }),
        }),
      );
    });

    it('an explicit status filter is passed through untouched when overdueOnly is not set', async () => {
      prisma.libraryBorrowing.findMany.mockResolvedValue([]);

      await service.listBorrowings({ status: 'returned' });

      expect(prisma.libraryBorrowing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'returned', dueAt: undefined }) }),
      );
    });

    it('bookSearch resolves to a set of bookCopyIds (by book title OR copy qrCode) before querying borrowings', async () => {
      prisma.libraryCatalogBook.findMany.mockResolvedValue([{ id: 'book-1' }]);
      prisma.libraryCatalogBookCopy.findMany
        .mockResolvedValueOnce([{ id: 'copy-1' }, { id: 'copy-2' }]) // bookSearch resolution pass
        .mockResolvedValueOnce([]); // enrichment pass (unreached since findMany below returns [])
      prisma.libraryBorrowing.findMany.mockResolvedValue([]);

      await service.listBorrowings({ bookSearch: 'Kalila' });

      expect(prisma.libraryBorrowing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ bookCopyId: { in: ['copy-1', 'copy-2'] } }) }),
      );
    });

    it('returns [] without querying borrowings when bookSearch matches no book/copy', async () => {
      prisma.libraryCatalogBook.findMany.mockResolvedValue([]);
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([]);

      const result = await service.listBorrowings({ bookSearch: 'Nonexistent' });

      expect(result).toEqual([]);
      expect(prisma.libraryBorrowing.findMany).not.toHaveBeenCalled();
    });

    it('returns [] without querying copies/books/students when nothing matches', async () => {
      prisma.libraryBorrowing.findMany.mockResolvedValue([]);

      const result = await service.listBorrowings({});

      expect(result).toEqual([]);
      expect(prisma.libraryCatalogBookCopy.findMany).not.toHaveBeenCalled();
    });
  });
});
