import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FinesService } from '../../../../../modules/library_circulation/backend/fines.service';

interface MockPrisma {
  libraryStudent: { findUnique: jest.Mock };
  libraryFineType: { findUnique: jest.Mock; findMany: jest.Mock };
  libraryFine: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  libraryFinancialTransaction: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
  libraryPayment: { create: jest.Mock; findMany: jest.Mock };
  libraryReceipt: { create: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    libraryStudent: { findUnique: jest.fn() },
    libraryFineType: { findUnique: jest.fn(), findMany: jest.fn() },
    libraryFine: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    libraryFinancialTransaction: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    libraryPayment: { create: jest.fn(), findMany: jest.fn() },
    libraryReceipt: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: MockPrisma) => unknown) => cb(prisma));
  return prisma;
}

function buildService(prisma: MockPrisma): FinesService {
  const service = new FinesService();
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
      expect(result.transaction.transactionNumber).toMatch(/^TXN-\d{8}-[0-9a-f]{8}$/);
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

      const result = await service.recordPayment('fine-1', 4, 'staff-1');
      expect(result.fine.status).toBe('partially_paid');
      expect(result.receipt.receiptNumber).toMatch(/^RC-\d{8}-[0-9a-f]{8}$/);
    });

    it('a payment covering the full remaining balance moves the fine to paid', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ amount: 10, amountPaid: 4 }));
      prisma.libraryFinancialTransaction.findFirst.mockResolvedValue({ id: 'txn-1', fineId: 'fine-1' });
      prisma.libraryPayment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'pay-2', ...data }));
      prisma.libraryReceipt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'rc-2', ...data }));
      prisma.libraryFine.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...fineRow(), ...data }));

      const result = await service.recordPayment('fine-1', 6, 'staff-1');
      expect(result.fine.status).toBe('paid');
    });

    it('§22: rejects a payment that would overpay the fine', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ amount: 10, amountPaid: 8 }));
      await expect(service.recordPayment('fine-1', 5, 'staff-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.libraryPayment.create).not.toHaveBeenCalled();
    });

    it('§22: rejects any further payment against an already-paid fine', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(fineRow({ status: 'paid', amount: 10, amountPaid: 10 }));
      await expect(service.recordPayment('fine-1', 1, 'staff-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s for a nonexistent fine', async () => {
      prisma.libraryFine.findUnique.mockResolvedValue(null);
      await expect(service.recordPayment('missing', 1, 'staff-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
