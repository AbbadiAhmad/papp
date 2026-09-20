import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { StudentsService } from '../../backend/students.service';

interface MockPrisma {
  user: { create: jest.Mock; findUnique: jest.Mock };
  role: { findUnique: jest.Mock };
  userRole: { create: jest.Mock };
  libraryStudent: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock; count: jest.Mock };
  libraryBorrowing: { findMany: jest.Mock; count: jest.Mock };
  libraryFine: { findMany: jest.Mock };
  auditLog: { findMany: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    user: { create: jest.fn(), findUnique: jest.fn() },
    role: { findUnique: jest.fn() },
    userRole: { create: jest.fn() },
    libraryStudent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    libraryBorrowing: { findMany: jest.fn(), count: jest.fn() },
    libraryFine: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  // Every test below runs a single top-level $transaction — hand it the SAME mock prisma as `tx`.
  prisma.$transaction.mockImplementation((cb: (tx: MockPrisma) => unknown) => cb(prisma));
  return prisma;
}

/** Same reflection idiom as library_catalog's books.service.spec.ts — see its own docblock for why. */
function buildService(prisma: MockPrisma): StudentsService {
  const service = new StudentsService();
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

function studentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'student-1',
    userId: 'user-1',
    code: 'STU-001',
    className: '5A',
    academicYearId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('StudentsService', () => {
  let prisma: MockPrisma;
  let service: StudentsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('create', () => {
    it('creates a User (reader role) + LibraryStudent in one transaction and returns a one-time temporary password', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-reader', code: 'reader' });
      prisma.user.create.mockResolvedValue({ id: 'user-1', name: 'Aisha', email: 'aisha@school.test' });
      prisma.userRole.create.mockResolvedValue({});
      prisma.libraryStudent.create.mockResolvedValue(studentRow());

      const result = await service.create(
        { name: 'Aisha', email: 'aisha@school.test', code: 'STU-001', className: '5A' },
        'admin-1',
      );

      expect(result.temporaryPassword).toBeTruthy();
      expect(result.temporaryPassword.length).toBeGreaterThan(8);
      expect(result.code).toBe('STU-001');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: true, createdBy: 'admin-1' }) }),
      );
      expect(prisma.userRole.create).toHaveBeenCalledWith({ data: { userId: 'user-1', roleId: 'role-reader', assignedBy: 'admin-1' } });
      // The password is never stored in the clear anywhere the DTO can see.
      const userCreateArg = prisma.user.create.mock.calls[0][0] as { data: { passwordHash: string } };
      expect(userCreateArg.data.passwordHash).not.toBe(result.temporaryPassword);
    });

    it('rejects when the "reader" role does not exist on this platform', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(service.create({ name: 'Aisha', email: 'a@b.test', code: 'STU-001' }, 'admin-1')).rejects.toThrow();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('translates a unique-constraint violation (duplicate email/code) into a ConflictException', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-reader', code: 'reader' });
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['email'] } }),
      );
      await expect(service.create({ name: 'Aisha', email: 'dup@b.test', code: 'STU-002' }, 'admin-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('remove', () => {
    it('deletes a student with no borrowing history', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryBorrowing.count.mockResolvedValue(0);
      prisma.libraryStudent.delete.mockResolvedValue(studentRow());

      await service.remove('student-1');
      expect(prisma.libraryStudent.delete).toHaveBeenCalledWith({ where: { id: 'student-1' } });
    });

    it('§22: refuses to delete a student who has borrowing history', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryBorrowing.count.mockResolvedValue(3);

      await expect(service.remove('student-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryStudent.delete).not.toHaveBeenCalled();
    });

    it('404s for a student that does not exist', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByCode', () => {
    it('404s when no student matches the scanned code', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      await expect(service.findByCode('STU-999')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('count', () => {
    it('§18: returns a real count for the dashboard, never a mock number', async () => {
      prisma.libraryStudent.count.mockResolvedValue(42);
      await expect(service.count()).resolves.toBe(42);
    });
  });

  describe('findById (§3.2 enrichment)', () => {
    it('returns name/email/isActive from the linked User plus computed borrowing/fine totals', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.user.findUnique.mockResolvedValue({ name: 'Aisha', email: 'aisha@school.test', isActive: true });
      prisma.libraryBorrowing.findMany.mockResolvedValue([{ id: 'b-1', status: 'active' }, { id: 'b-2', status: 'overdue' }]);
      prisma.libraryFine.findMany
        .mockResolvedValueOnce([]) // openFines
        .mockResolvedValueOnce([
          { status: 'unpaid', amount: '20.00', amountPaid: '0.00' },
          { status: 'paid', amount: '10.00', amountPaid: '10.00' },
        ]); // allFines (for the two totals)

      const result = await service.findById('student-1');

      expect(result.name).toBe('Aisha');
      expect(result.isActive).toBe(true);
      expect(result.activeBorrowingsCount).toBe(2);
      expect(result.unpaidFinesTotal).toBe(20);
      expect(result.paidFinesTotal).toBe(10);
    });

    it('404s for an unknown student before touching User/borrowing/fine lookups', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getReadingHistory (§3.2)', () => {
    it('returns every borrowing ever, ordered most-recent-first', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryBorrowing.findMany.mockResolvedValue([{ id: 'b-1' }]);

      const result = await service.getReadingHistory('student-1');

      expect(prisma.libraryBorrowing.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        orderBy: { borrowedAt: 'desc' },
      });
      expect(result).toEqual([{ id: 'b-1' }]);
    });

    it('404s for an unknown student', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      await expect(service.getReadingHistory('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getActionHistory (§3.3)', () => {
    it('queries audit_log scoped to this LibraryStudent entity', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.auditLog.findMany.mockResolvedValue([{ id: 'a-1', action: 'update' }]);

      const result = await service.getActionHistory('student-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { entityType: 'LibraryStudent', entityId: 'student-1' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(result).toEqual([{ id: 'a-1', action: 'update' }]);
    });

    it('404s for an unknown student before querying audit_log', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      await expect(service.getActionHistory('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });
  });
});
