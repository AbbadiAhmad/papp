import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FinesService } from '../../backend/fines.service';

interface MockPrisma {
  libraryStudent: { findUnique: jest.Mock; findMany: jest.Mock };
  libraryFineType: { findUnique: jest.Mock; findMany: jest.Mock };
  libraryFine: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  libraryFinancialTransaction: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
  libraryPayment: { create: jest.Mock; findMany: jest.Mock };
  libraryReceipt: { create: jest.Mock };
  libraryBorrowing: { findUnique: jest.Mock };
  libraryCatalogBookCopy: { findUnique: jest.Mock };
  libraryCatalogBook: { findUnique: jest.Mock };
  user: { findMany: jest.Mock };
  $transaction: jest.Mock;
  $queryRawUnsafe: jest.Mock;
}

/** `nextNumber()` reads a real Postgres sequence via `$queryRawUnsafe` — mocked here as a simple incrementing counter, one per test. */
function createMockPrisma(): MockPrisma {
  let sequenceCounter = 0;
  const prisma: MockPrisma = {
    libraryStudent: { findUnique: jest.fn(), findMany: jest.fn() },
    libraryFineType: { findUnique: jest.fn(), findMany: jest.fn() },
    libraryFine: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    libraryFinancialTransaction: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    libraryPayment: { create: jest.fn(), findMany: jest.fn() },
    libraryReceipt: { create: jest.fn() },
    libraryBorrowing: { findUnique: jest.fn() },
    libraryCatalogBookCopy: { findUnique: jest.fn() },
    libraryCatalogBook: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: MockPrisma) => unknown) => cb(prisma));
  prisma.$queryRawUnsafe.mockImplementation(() => {
    sequenceCounter += 1;
    return Promise.resolve([{ nextval: BigInt(sequenceCounter) }]);
  });
  return prisma;
}

function buildService(prisma: MockPrisma, notifications: { send: jest.Mock } = { send: jest.fn() }): FinesService {
  const service = new FinesService(notifications as never);
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

function fineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fine-1',
    studentId: 'student-1',
    borrowingId: 'borrowing-1',
    fineTypeId: 'type-1',
    status: 'unpaid',
    amount: 10,
    amountPaid: 0,
    notes: null,
    createdBy: 'staff-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('FinesService', () => {
  let prisma: MockPrisma;
  let service: FinesService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('create', () => {
    const dto = { studentId: 'student-1', fineTypeId: 'type-1', amount: 5, borrowingId: 'borrowing-1' };

    it('creates a fine + matching financial transaction with a unique number', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue({ id: 'student-1' });
      prisma.libraryFineType.findUnique.mockResolvedValue({ id: 'type-1', code: 'FINE-OTHER' });
      prisma.libraryFine.findFirst.mockResolvedValue(null); // no duplicate
      prisma.libraryFine.create.mockResolvedValue(fineRow());
      prisma.libraryFinancialTransaction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: 'txn-1',
        ...data,
      }));

      const result = await service.create(dto, 'staff-1');
      expect(result.transaction.transactionNumber).toMatch(/^FIN-\d{6}$/);
    });

    it('§14/§22: rejects a duplicate open fine (same student+borrowing+type) unless confirmDuplicate is set', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue({ id: 'student-1' });
      prisma.libraryFineType.findUnique.mockResolvedValue({ id: 'type-1' });
      prisma.libraryFine.findFirst.mockResolvedValue(fineRow({ id: 'existing-fine' }));

      await expect(service.create(dto, 'staff-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryFine.create).not.toHaveBeenCalled();
    });

    it('allows a duplicate fine when confirmDuplicate is explicitly set', async () => {
      prisma.libraryStudent.findUnique.mockResolvedValue({ id: 'student-1' });
      prisma.libraryFineType.findUnique.mockResolvedValue({ id: 'type-1' });
      prisma.libraryFine.findFirst.mockResolvedValue(fineRow({ id: 'existing-fine' }));
      prisma.libraryFine.create.mockResolvedValue(fineRow());
      prisma.libraryFinancialTransaction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: 'txn-2',
        ...data,
      }));

      await expect(service.create({ ...dto, confirmDuplicate: true }, 'staff-1')).resolves.toBeDefined();
      expect(prisma.libraryFine.create).toHaveBeenCalled();
    });
  });

  describe('waive', () => {
    it('waives an open fine', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow());
      prisma.libraryFine.update.mockResolvedValue(fineRow({ status: 'waived' }));
      const result = await service.waive('fine-1');
      expect(result.status).toBe('waived');
    });

    it('§22: refuses to waive a fully paid fine', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'paid' }));
      await expect(service.waive('fine-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('recordPayment', () => {
    it('a partial payment moves the fine to partially_paid', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ amount: 10, amountPaid: 0 }));
      prisma.libraryFinancialTransaction.findFirst.mockResolvedValue({ id: 'txn-1', fineId: 'fine-1' });
      prisma.libraryPayment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'pay-1', ...data }));
      prisma.libraryReceipt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'rc-1', ...data }));
      prisma.libraryFine.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...fineRow(), ...data }));

      const result = await service.recordPayment('fine-1', 4, 'staff-1', 'cash');
      expect(result.fine.status).toBe('partially_paid');
      expect(result.receipt.receiptNumber).toMatch(/^REC-\d{6}$/);
      expect(result.payment.paymentNumber).toMatch(/^PAY-\d{6}$/);
      expect(result.payment.paymentMethod).toBe('cash');
    });

    it('a payment covering the full remaining balance moves the fine to paid', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ amount: 10, amountPaid: 4 }));
      prisma.libraryFinancialTransaction.findFirst.mockResolvedValue({ id: 'txn-1', fineId: 'fine-1' });
      prisma.libraryPayment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'pay-2', ...data }));
      prisma.libraryReceipt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'rc-2', ...data }));
      prisma.libraryFine.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...fineRow(), ...data }));

      const result = await service.recordPayment('fine-1', 6, 'staff-1', 'card');
      expect(result.fine.status).toBe('paid');
      expect(result.payment.paymentMethod).toBe('card');
    });

    it('§22: rejects a payment that would overpay the fine', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ amount: 10, amountPaid: 8 }));
      await expect(service.recordPayment('fine-1', 5, 'staff-1', 'cash')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.libraryPayment.create).not.toHaveBeenCalled();
    });

    it('§22: rejects any further payment against an already-paid fine', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'paid', amount: 10, amountPaid: 10 }));
      await expect(service.recordPayment('fine-1', 1, 'staff-1', 'cash')).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s for a nonexistent fine', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(null);
      await expect(service.recordPayment('missing', 1, 'staff-1', 'cash')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('edits amount/notes while unpaid, keeping the ledger transaction amount in sync', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'unpaid', amount: 10, amountPaid: 0 }));
      prisma.libraryFine.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...fineRow(), ...data }));

      const result = await service.update('fine-1', { amount: 15, notes: 'adjusted' }, false);

      expect(result.amount).toBe(15);
      expect(prisma.libraryFinancialTransaction.updateMany).toHaveBeenCalledWith({ where: { fineId: 'fine-1' }, data: { amount: 15 } });
    });

    it('editing a partially_paid fine down to exactly the paid amount flips it to paid', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'partially_paid', amount: 10, amountPaid: 6 }));
      prisma.libraryFine.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...fineRow(), ...data }));

      const result = await service.update('fine-1', { amount: 6 }, false);
      expect(result.status).toBe('paid');
    });

    it('rejects lowering the amount below what has already been paid', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'partially_paid', amount: 10, amountPaid: 6 }));
      await expect(service.update('fine-1', { amount: 5 }, false)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.libraryFine.update).not.toHaveBeenCalled();
    });

    it('rejects editing a paid fine without allowAfterPayment', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'paid', amount: 10, amountPaid: 10 }));
      await expect(service.update('fine-1', { amount: 12 }, false)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryFine.update).not.toHaveBeenCalled();
    });

    it('allows editing a paid fine when allowAfterPayment is true', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'paid', amount: 10, amountPaid: 10 }));
      prisma.libraryFine.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...fineRow(), ...data }));

      const result = await service.update('fine-1', { amount: 20 }, true);
      expect(result.status).toBe('partially_paid'); // 10 paid against a new 20 total is no longer "fully paid"
    });

    it('rejects editing a waived fine even with allowAfterPayment', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'waived' }));
      await expect(service.update('fine-1', { amount: 5 }, true)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findById (fine detail enrichment)', () => {
    it('resolves createdBy/receivedBy to names and joins in the borrowing/book context', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ createdBy: 'staff-1' }));
      prisma.libraryFinancialTransaction.findFirst.mockResolvedValue({ id: 'txn-1', fineId: 'fine-1' });
      prisma.libraryPayment.findMany.mockResolvedValue([{ id: 'pay-1', receivedBy: 'staff-2', amount: 10, paymentMethod: 'cash' }]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'staff-1', name: 'Aisha' },
        { id: 'staff-2', name: 'Omar' },
      ]);
      prisma.libraryBorrowing.findUnique.mockResolvedValue({
        id: 'borrowing-1',
        bookCopyId: 'copy-1',
        dueAt: new Date('2026-01-01T00:00:00Z'),
        returnedAt: new Date('2026-01-05T00:00:00Z'),
        returnStatus: 'returned',
      });
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue({ id: 'copy-1', bookId: 'book-1', qrCode: 'BOOK-001' });
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1', title: 'Kalila wa Dimna' });

      const result = await service.findById('fine-1');

      expect(result.createdByName).toBe('Aisha');
      expect(result.payments[0].receivedByName).toBe('Omar');
      expect(result.borrowingContext).toMatchObject({ bookTitle: 'Kalila wa Dimna', qrCode: 'BOOK-001', daysLate: 4 });
    });

    it('borrowingContext is null when the fine has no linked borrowing', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ borrowingId: null }));
      prisma.libraryFinancialTransaction.findFirst.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.findById('fine-1');
      expect(result.borrowingContext).toBeNull();
      expect(prisma.libraryBorrowing.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getFinanceSummary', () => {
    it('§18: sums real fine rows into paid/unpaid totals, never mock numbers', async () => {
      prisma.libraryFine.findMany.mockResolvedValue([
        { amount: 10, amountPaid: 10 }, // fully paid
        { amount: 20, amountPaid: 5 }, // partially paid
        { amount: 8, amountPaid: 0 }, // unpaid
      ]);

      const summary = await service.getFinanceSummary();
      expect(summary.paidTotal).toBe(15); // 10 + 5 + 0
      expect(summary.unpaidTotal).toBe(23); // 0 + 15 + 8
    });
  });

  describe('list (Fines page filters)', () => {
    it('enriches each fine with reader code/name, fine type name, and creator name, plus a filtered total', async () => {
      prisma.libraryFine.findMany.mockResolvedValue([fineRow({ id: 'fine-1', amount: 10 }), fineRow({ id: 'fine-2', amount: 5 })]);
      prisma.libraryStudent.findMany.mockResolvedValue([{ id: 'student-1', code: 'STU-001', userId: 'user-reader' }]);
      prisma.libraryFineType.findMany.mockResolvedValue([{ id: 'type-1', name: 'Late Return' }]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'staff-1', name: 'Aisha' },
        { id: 'user-reader', name: 'Omar' },
      ]);

      const result = await service.list({});

      expect(result.totalAmount).toBe(15);
      expect(result.fines[0]).toMatchObject({ studentCode: 'STU-001', studentName: 'Omar', fineTypeName: 'Late Return', createdByName: 'Aisha' });
    });

    it('createdByName filters down to fines created by matching users, resolved via a name search first', async () => {
      prisma.user.findMany.mockResolvedValueOnce([{ id: 'staff-1' }]); // name search
      prisma.libraryFine.findMany.mockResolvedValue([fineRow({ createdBy: 'staff-1' })]);
      prisma.libraryStudent.findMany.mockResolvedValue([]);
      prisma.libraryFineType.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValueOnce([{ id: 'staff-1', name: 'Aisha' }]); // resolving names for the enrichment pass

      await service.list({ createdByName: 'Aisha' });

      expect(prisma.libraryFine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ createdBy: { in: ['staff-1'] } }) }),
      );
    });

    it('returns an empty result without querying fines when createdByName matches nobody', async () => {
      prisma.user.findMany.mockResolvedValueOnce([]); // name search finds nobody
      const result = await service.list({ createdByName: 'Nobody' });
      expect(result).toEqual({ fines: [], totalAmount: 0 });
      expect(prisma.libraryFine.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listPayments (Finance page filters)', () => {
    it('enriches each payment with receiver/fine-creator names and the fine it belongs to, plus a filtered total', async () => {
      prisma.libraryPayment.findMany.mockResolvedValue([{ id: 'pay-1', transactionId: 'txn-1', receivedBy: 'staff-2', amount: 10, paymentMethod: 'cash', paidAt: new Date() }]);
      prisma.libraryFinancialTransaction.findMany.mockResolvedValue([{ id: 'txn-1', fineId: 'fine-1' }]);
      prisma.libraryFine.findMany.mockResolvedValue([fineRow({ id: 'fine-1', createdBy: 'staff-1' })]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'staff-1', name: 'Aisha' },
        { id: 'staff-2', name: 'Omar' },
      ]);

      const result = await service.listPayments({});

      expect(result.totalAmount).toBe(10);
      expect(result.payments[0]).toMatchObject({ receivedByName: 'Omar', createdByName: 'Aisha', fineNumber: fineRow().fineNumber });
    });

    it('returns an empty result without querying payments when receivedByName matches nobody', async () => {
      prisma.user.findMany.mockResolvedValueOnce([]);
      const result = await service.listPayments({ receivedByName: 'Nobody' });
      expect(result).toEqual({ payments: [], totalAmount: 0 });
      expect(prisma.libraryPayment.findMany).not.toHaveBeenCalled();
    });

    it('date range filters translate to an inclusive paidAt gte/lte', async () => {
      prisma.libraryPayment.findMany.mockResolvedValue([]);
      await service.listPayments({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
      const call = prisma.libraryPayment.findMany.mock.calls[0][0] as { where: { paidAt: { gte: Date; lte: Date } } };
      expect(call.where.paidAt.gte.toISOString().startsWith('2026-01-01')).toBe(true);
      expect(call.where.paidAt.lte.toISOString().startsWith('2026-01-31')).toBe(true);
    });
  });
});
