import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CirculationService } from '../../../../../modules/library_circulation/backend/circulation.service';

interface MockPrisma {
  libraryStudent: { findUnique: jest.Mock };
  libraryCatalogBookCopy: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock };
  libraryCatalogBook: { findUnique: jest.Mock };
  libraryBorrowing: { count: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  user: { findUnique: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    libraryStudent: { findUnique: jest.fn() },
    libraryCatalogBookCopy: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    libraryCatalogBook: { findUnique: jest.fn() },
    libraryBorrowing: { count: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
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

    it('404s when the code matches nothing at all', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);
      await expect(service.scan('NOPE')).rejects.toBeInstanceOf(NotFoundException);
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
  });

  describe('findActiveBorrowingForCopy', () => {
    it('404s when the copy has no active borrowing (nothing to return)', async () => {
      prisma.libraryBorrowing.findFirst.mockResolvedValue(null);
      await expect(service.findActiveBorrowingForCopy('copy-1')).rejects.toBeInstanceOf(NotFoundException);
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
});
