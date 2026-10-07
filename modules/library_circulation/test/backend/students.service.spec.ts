import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { StudentsService } from '../../backend/students.service';

interface MockPrisma {
  user: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  role: { findUnique: jest.Mock };
  userRole: { create: jest.Mock; count: jest.Mock; deleteMany: jest.Mock };
  libraryStudent: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock; count: jest.Mock };
  libraryBorrowing: { findMany: jest.Mock; count: jest.Mock };
  libraryFine: { findMany: jest.Mock };
  libraryCatalogBookCopy: { findMany: jest.Mock };
  libraryCatalogBook: { findMany: jest.Mock };
  auditLog: { findMany: jest.Mock };
  $transaction: jest.Mock;
  $executeRawUnsafe: jest.Mock;
  $queryRawUnsafe: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    user: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    role: { findUnique: jest.fn() },
    userRole: { create: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
    libraryStudent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    libraryBorrowing: { findMany: jest.fn(), count: jest.fn() },
    libraryFine: { findMany: jest.fn() },
    libraryCatalogBookCopy: { findMany: jest.fn() },
    libraryCatalogBook: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
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

  describe('self-registered readers (bug fix)', () => {
    it('list() first creates a profile for every reader-role user that has none', async () => {
      prisma.libraryStudent.findMany.mockResolvedValue([]);
      await service.list();
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      const [sql, roleCode] = prisma.$executeRawUnsafe.mock.calls[0] as [string, string];
      expect(sql).toContain('INSERT INTO library_students');
      expect(sql).toContain('ON CONFLICT DO NOTHING');
      expect(roleCode).toBe('reader');
    });

    it('search(), count() and findByCode() sync too, so a code scan finds a self-registered reader', async () => {
      prisma.libraryStudent.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.libraryStudent.count.mockResolvedValue(0);
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      await service.search('ai');
      await service.count();
      await service.findByCode('STU-001');
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    });
  });

  describe('automatic reader codes', () => {
    it('create() without a code takes the next sequence value, formatted STU + 6 digits', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-reader', code: 'reader' });
      prisma.user.create.mockResolvedValue({ id: 'user-1', name: 'Aisha', email: 'a@b.test' });
      prisma.userRole.create.mockResolvedValue({});
      prisma.libraryStudent.findUnique.mockResolvedValue(null); // generated code is free
      prisma.$queryRawUnsafe.mockResolvedValue([{ nextval: BigInt(42) }]);
      prisma.libraryStudent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => studentRow(data));

      const result = await service.create({ name: 'Aisha', email: 'a@b.test' }, 'admin-1');

      expect(result.code).toBe('STU000042');
    });

    it('create() with a typed STU-format code keeps it and fast-forwards the sequence past it', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-reader', code: 'reader' });
      prisma.user.create.mockResolvedValue({ id: 'user-1', name: 'Aisha', email: 'a@b.test' });
      prisma.userRole.create.mockResolvedValue({});
      prisma.libraryStudent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => studentRow(data));

      const result = await service.create({ name: 'Aisha', email: 'a@b.test', code: 'STU000100' }, 'admin-1');

      expect(result.code).toBe('STU000100');
      const [sql, value] = prisma.$queryRawUnsafe.mock.calls[0] as [string, bigint];
      expect(sql).toContain('setval');
      expect(value).toBe(BigInt(100));
    });

    it('skips a sequence value that a hand-typed code already occupies', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ nextval: BigInt(5) }]).mockResolvedValueOnce([{ nextval: BigInt(6) }]);
      prisma.libraryStudent.findUnique.mockResolvedValueOnce({ id: 'taken' }).mockResolvedValueOnce(null);
      expect(await service.allocateCode()).toBe('STU000006');
    });

    it('peekNextCode() reads the sequence without consuming it', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ last_value: BigInt(9), is_called: true }]);
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      expect(await service.peekNextCode()).toBe('STU000010');
      expect(prisma.$queryRawUnsafe.mock.calls[0][0]).not.toContain('nextval');
    });

    it('a typed code outside the STU<digits> format leaves the sequence alone', async () => {
      await service.reconcileCodeSequence(prisma, 'LEGACY-7');
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('update (full reader edit, no roles)', () => {
    beforeEach(() => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.user.findUnique.mockResolvedValue({ name: 'Aisha', email: 'a@b.test' });
      prisma.userRole.count.mockResolvedValue(0);
    });

    it('updates the linked account and the profile in one transaction', async () => {
      await service.update('student-1', { name: 'Aisha K', email: 'new@b.test', department: 'Science', code: 'STU-009', className: '' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({ name: 'Aisha K', email: 'new@b.test', department: 'Science' }),
      });
      expect(prisma.libraryStudent.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: { code: 'STU-009', className: null, academicYearId: undefined },
      });
      expect(prisma.userRole.create).not.toHaveBeenCalled(); // never touches roles
    });

    it('resetPassword issues a hashed temporary password, forces a change, and returns it once', async () => {
      const result = (await service.update('student-1', { resetPassword: true })) as { temporaryPassword?: string };

      expect(result.temporaryPassword).toBeTruthy();
      const data = (prisma.user.update.mock.calls[0][0] as { data: { passwordHash: string; mustChangePassword: boolean } }).data;
      expect(data.mustChangePassword).toBe(true);
      expect(data.passwordHash).not.toBe(result.temporaryPassword);
    });

    it('refuses to deactivate an account that also holds a non-reader role', async () => {
      prisma.userRole.count.mockResolvedValue(1);
      await expect(service.update('student-1', { isActive: false })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('translates a duplicate email into a ConflictException', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.0.0', meta: { target: ['email'] } }),
      );
      await expect(service.update('student-1', { email: 'dup@b.test' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('deletes a student with no borrowing history', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryBorrowing.count.mockResolvedValue(0);
      prisma.libraryStudent.delete.mockResolvedValue(studentRow());

      await service.remove('student-1');
      expect(prisma.libraryStudent.delete).toHaveBeenCalledWith({ where: { id: 'student-1' } });
      // The account stops being a reader, or syncReaderProfiles() would resurrect the profile.
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', role: { code: 'reader' } } });
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
    it('returns name/email/isActive from the linked User plus computed borrowing/fine totals, with each active borrowing enriched with its book title', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.user.findUnique.mockResolvedValue({ name: 'Aisha', email: 'aisha@school.test', isActive: true });
      prisma.libraryBorrowing.findMany.mockResolvedValue([
        { id: 'b-1', status: 'active', bookCopyId: 'copy-1' },
        { id: 'b-2', status: 'overdue', bookCopyId: 'copy-2' },
      ]);
      prisma.libraryFine.findMany
        .mockResolvedValueOnce([]) // openFines
        .mockResolvedValueOnce([
          { status: 'unpaid', amount: '20.00', amountPaid: '0.00' },
          { status: 'paid', amount: '10.00', amountPaid: '10.00' },
        ]); // allFines (for the two totals)
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([
        { id: 'copy-1', bookId: 'book-1', qrCode: 'BOOK-001' },
        { id: 'copy-2', bookId: 'book-2', qrCode: 'BOOK-002' },
      ]);
      prisma.libraryCatalogBook.findMany.mockResolvedValue([
        { id: 'book-1', title: 'Kalila wa Dimna', readingLevel: 'B2' },
        { id: 'book-2', title: 'The Little Prince', readingLevel: 'A2' },
      ]);

      const result = await service.findById('student-1');

      expect(result.name).toBe('Aisha');
      expect(result.isActive).toBe(true);
      expect(result.activeBorrowingsCount).toBe(2);
      expect(result.unpaidFinesTotal).toBe(20);
      expect(result.paidFinesTotal).toBe(10);
      expect(result.activeBorrowings[0]).toMatchObject({ id: 'b-1', bookTitle: 'Kalila wa Dimna', readingLevel: 'B2' });
      expect(result.activeBorrowings[1]).toMatchObject({ id: 'b-2', bookTitle: 'The Little Prince', readingLevel: 'A2' });
    });

    it('404s for an unknown student before touching User/borrowing/fine lookups', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getReadingHistory (§3.2)', () => {
    it('returns every borrowing ever, ordered most-recent-first, each enriched with its book title/reading level/category/qrCode', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryBorrowing.findMany.mockResolvedValue([{ id: 'b-1', bookCopyId: 'copy-1' }]);
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([{ id: 'copy-1', bookId: 'book-1', qrCode: 'BOOK-001' }]);
      prisma.libraryCatalogBook.findMany.mockResolvedValue([{ id: 'book-1', title: 'Kalila wa Dimna', readingLevel: 'B2', category: 'Fiction' }]);

      const result = await service.getReadingHistory('student-1');

      expect(prisma.libraryBorrowing.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        orderBy: { borrowedAt: 'desc' },
      });
      expect(result).toEqual([
        { id: 'b-1', bookCopyId: 'copy-1', qrCode: 'BOOK-001', bookTitle: 'Kalila wa Dimna', readingLevel: 'B2', category: 'Fiction' },
      ]);
    });

    it('returns an empty array without querying copies/books when there is no borrowing history', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.libraryBorrowing.findMany.mockResolvedValue([]);

      const result = await service.getReadingHistory('student-1');

      expect(result).toEqual([]);
      expect(prisma.libraryCatalogBookCopy.findMany).not.toHaveBeenCalled();
    });

    it('404s for an unknown student', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      await expect(service.getReadingHistory('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getActionHistory (§3.3)', () => {
    it('resolves the actor into a name and the raw column diff into labeled field changes — never a raw UUID/id dump', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(studentRow());
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'a-1',
          occurredAt: new Date('2026-01-02T00:00:00Z'),
          actorType: 'user',
          actorUserId: 'admin-1',
          action: 'update',
          oldValue: { id: 'student-1', userId: 'user-1', code: 'STU-001', className: '5A', academicYearId: null },
          newValue: { id: 'student-1', userId: 'user-1', code: 'STU-001', className: '5B', academicYearId: null },
        },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Admin User' }]);

      const result = await service.getActionHistory('student-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { entityType: 'LibraryStudent', entityId: 'student-1' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(result).toEqual([
        {
          id: 'a-1',
          occurredAt: new Date('2026-01-02T00:00:00Z'),
          actorType: 'user',
          actorName: 'Admin User',
          action: 'update',
          changes: [{ field: 'className', before: '5A', after: '5B' }],
        },
      ]);
    });

    it('404s for an unknown student before querying audit_log', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue(null);
      await expect(service.getActionHistory('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('bug fix: joins in each reader\'s name from the linked User (D41), not just code/class', async () => {
      prisma.libraryStudent.findMany.mockResolvedValue([
        studentRow({ id: 'student-1', userId: 'user-1', code: 'STU-001' }),
        studentRow({ id: 'student-2', userId: 'user-2', code: 'STU-002' }),
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'Aisha', email: 'aisha@school.test', isActive: true, externalId: null, department: null },
        { id: 'user-2', name: 'Omar', email: 'omar@school.test', isActive: false, externalId: null, department: null },
      ]);

      const result = await service.list();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-1', 'user-2'] } },
        select: { id: true, name: true, email: true, isActive: true, externalId: true, department: true },
      });
      expect(result).toEqual([
        expect.objectContaining({ id: 'student-1', name: 'Aisha' }),
        expect.objectContaining({ id: 'student-2', name: 'Omar', email: 'omar@school.test', isActive: false }),
      ]);
    });

    it('returns name: null for a student whose linked user is somehow missing, without throwing', async () => {
      prisma.libraryStudent.findMany.mockResolvedValue([studentRow({ id: 'student-1', userId: 'user-1' })]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.list();

      expect(result).toEqual([expect.objectContaining({ id: 'student-1', name: null })]);
    });

    it('skips the User lookup entirely when there are no students', async () => {
      prisma.libraryStudent.findMany.mockResolvedValue([]);

      const result = await service.list();

      expect(result).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('returns [] for a blank query without touching the database', async () => {
      const result = await service.search('   ');
      expect(result).toEqual([]);
      expect(prisma.libraryStudent.findMany).not.toHaveBeenCalled();
    });

    it('merges code matches and name matches, capped at the limit', async () => {
      prisma.libraryStudent.findMany.mockResolvedValueOnce([studentRow({ id: 'student-1', code: 'STU-001', userId: 'user-1' })]); // by code
      prisma.user.findMany
        .mockResolvedValueOnce([]) // name search finds nobody
        .mockResolvedValueOnce([{ id: 'user-1', name: 'Aisha' }]); // resolving the code match's own name afterward

      const result = await service.search('STU-001', 5);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'student-1', code: 'STU-001', name: 'Aisha' });
    });
  });
});
