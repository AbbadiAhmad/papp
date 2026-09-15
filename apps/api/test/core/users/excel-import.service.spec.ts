import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import { ExcelImportService } from '../../../src/core/users/excel-import.service';

interface MockTx {
  role: { findUniqueOrThrow: jest.Mock };
  user: { update: jest.Mock; create: jest.Mock };
  userRole: { upsert: jest.Mock; create: jest.Mock };
}

interface MockPrisma {
  role: { findMany: jest.Mock };
  user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; upsert: jest.Mock };
  userRole: { upsert: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
}

/** Builds a tiny real .xlsx buffer in memory — same library the service parses with. */
async function buildXlsx(headers: string[], rows: (string | null | undefined)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  worksheet.addRow(headers);
  for (const row of rows) {
    worksheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

const HEADERS = ['name', 'email', 'ID', 'Role', 'department'];

function expectZeroWrites(prisma: MockPrisma, tx: MockTx): void {
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(prisma.user.create).not.toHaveBeenCalled();
  expect(prisma.user.update).not.toHaveBeenCalled();
  expect(prisma.user.upsert).not.toHaveBeenCalled();
  expect(prisma.userRole.upsert).not.toHaveBeenCalled();
  expect(prisma.userRole.create).not.toHaveBeenCalled();
  expect(tx.user.update).not.toHaveBeenCalled();
  expect(tx.user.create).not.toHaveBeenCalled();
  expect(tx.userRole.upsert).not.toHaveBeenCalled();
  expect(tx.userRole.create).not.toHaveBeenCalled();
}

describe('ExcelImportService (D30 + D42)', () => {
  let prisma: MockPrisma;
  let tx: MockTx;
  let service: ExcelImportService;
  /** Existing users the mocked user.findUnique resolves against. */
  let usersByExternalId: Map<string, { id: string; email: string }>;
  let usersByEmail: Map<string, { id: string; email: string }>;

  beforeEach(() => {
    usersByExternalId = new Map();
    usersByEmail = new Map();
    tx = {
      role: { findUniqueOrThrow: jest.fn() },
      user: { update: jest.fn(), create: jest.fn() },
      userRole: { upsert: jest.fn(), create: jest.fn() },
    };
    prisma = {
      role: { findMany: jest.fn() },
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
      userRole: { upsert: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.role.findMany.mockResolvedValue([{ code: 'reader' }, { code: 'admin' }]);
    prisma.user.findUnique.mockImplementation((args: unknown) => {
      const where = (args as { where: { externalId?: string; email?: string } }).where;
      if (where.externalId !== undefined) return Promise.resolve(usersByExternalId.get(where.externalId) ?? null);
      if (where.email !== undefined) return Promise.resolve(usersByEmail.get(where.email) ?? null);
      return Promise.resolve(null);
    });
    prisma.$transaction.mockImplementation((fn: unknown) => (fn as (t: MockTx) => Promise<unknown>)(tx));
    tx.role.findUniqueOrThrow.mockResolvedValue({ id: 'role-reader', code: 'reader' });
    tx.user.create.mockImplementation((args: unknown) =>
      Promise.resolve({ id: 'new-user-1', ...(args as { data: object }).data }),
    );
    tx.user.update.mockResolvedValue({});
    tx.userRole.upsert.mockResolvedValue({});
    tx.userRole.create.mockResolvedValue({});
    service = new ExcelImportService(prisma as never);
  });

  describe('parseWorkbook', () => {
    it('maps recognized headers case-insensitively and skips blank rows', async () => {
      const buffer = await buildXlsx(HEADERS, [
        ['Amina Hassan', 'amina@example.com', 'EMP-1', 'reader', 'Library'],
        [], // fully blank row — must be skipped, not parsed as an empty record
        ['Omar Khalid', 'omar@example.com', undefined, 'admin', undefined],
      ]);

      const rows = await service.parseWorkbook(buffer);

      expect(rows).toEqual([
        { row: 2, name: 'Amina Hassan', email: 'amina@example.com', externalId: 'EMP-1', roleCode: 'reader', department: 'Library' },
        { row: 4, name: 'Omar Khalid', email: 'omar@example.com', externalId: null, roleCode: 'admin', department: null },
      ]);
      expect(prisma.user.findUnique).not.toHaveBeenCalled(); // parsing touches no DB
    });

    it('rejects a buffer that is not a valid .xlsx workbook', async () => {
      await expect(service.parseWorkbook(Buffer.from('not an xlsx file'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a workbook whose header row has no recognized columns', async () => {
      const buffer = await buildXlsx(['foo', 'bar'], [['x', 'y']]);

      await expect(service.parseWorkbook(buffer)).rejects.toThrow(/No recognized columns/);
    });
  });

  describe('validateRows (the preview path)', () => {
    it('marks well-formed new rows valid with action=create and allValid=true', async () => {
      const buffer = await buildXlsx(HEADERS, [
        ['Amina Hassan', 'amina@example.com', 'EMP-1', 'reader', 'Library'],
        ['Omar Khalid', 'omar@example.com', null, 'admin', null],
      ]);
      const rows = await service.parseWorkbook(buffer);

      const report = await service.validateRows(rows);

      expect(report.allValid).toBe(true);
      expect(report.validCount).toBe(2);
      expect(report.invalidCount).toBe(0);
      expect(report.rows[0]).toMatchObject({ valid: true, error: null, action: 'create', matchedUserId: null });
      expect(report.rows[1]).toMatchObject({ valid: true, error: null, action: 'create', matchedUserId: null });
    });

    it('rejects a row missing the required email field with the right message', async () => {
      const buffer = await buildXlsx(HEADERS, [['Amina Hassan', null, 'EMP-1', 'reader', null]]);
      const rows = await service.parseWorkbook(buffer);

      const report = await service.validateRows(rows);

      expect(report.allValid).toBe(false);
      expect(report.rows[0]).toMatchObject({
        valid: false,
        error: 'Missing required field: email',
        action: null,
        matchedUserId: null,
      });
    });

    it('rejects a row with an unknown role code', async () => {
      const buffer = await buildXlsx(HEADERS, [['Amina Hassan', 'amina@example.com', null, 'ghost_role', null]]);
      const rows = await service.parseWorkbook(buffer);

      const report = await service.validateRows(rows);

      expect(report.rows[0].valid).toBe(false);
      expect(report.rows[0].error).toBe('Unknown role code: ghost_role');
    });

    it('rejects the D30 conflict: row ID matches user A but row email matches a different user B', async () => {
      usersByExternalId.set('EMP-1', { id: 'user-a', email: 'a@example.com' });
      usersByEmail.set('b@example.com', { id: 'user-b', email: 'b@example.com' });
      const buffer = await buildXlsx(HEADERS, [['Someone', 'b@example.com', 'EMP-1', 'reader', null]]);
      const rows = await service.parseWorkbook(buffer);

      const report = await service.validateRows(rows);

      expect(report.rows[0].valid).toBe(false);
      expect(report.rows[0].error).toBe(
        "Row's ID matches an existing user (a@example.com) but its email matches a different existing user (b@example.com)",
      );
    });

    it('resolves action=update with matchedUserId when the email matches an existing user', async () => {
      usersByEmail.set('amina@example.com', { id: 'user-a', email: 'amina@example.com' });
      const buffer = await buildXlsx(HEADERS, [['Amina Hassan', 'amina@example.com', null, 'reader', null]]);
      const rows = await service.parseWorkbook(buffer);

      const report = await service.validateRows(rows);

      expect(report.rows[0]).toMatchObject({ valid: true, action: 'update', matchedUserId: 'user-a' });
    });

    it('rejects two rows in the same file claiming the same email', async () => {
      const buffer = await buildXlsx(HEADERS, [
        ['Amina Hassan', 'same@example.com', null, 'reader', null],
        ['Omar Khalid', 'same@example.com', null, 'reader', null],
      ]);
      const rows = await service.parseWorkbook(buffer);

      const report = await service.validateRows(rows);

      expect(report.rows[0].valid).toBe(true);
      expect(report.rows[1].valid).toBe(false);
      expect(report.rows[1].error).toBe('Duplicate email within this file (also used on row 2)');
    });

    it('NEVER writes — preview of a mixed valid/invalid file performs zero mutations (D42)', async () => {
      usersByEmail.set('existing@example.com', { id: 'user-a', email: 'existing@example.com' });
      const buffer = await buildXlsx(HEADERS, [
        ['New Person', 'new@example.com', null, 'reader', null],
        ['Existing Person', 'existing@example.com', null, 'admin', null],
        ['Broken Row', null, null, 'reader', null],
      ]);
      const rows = await service.parseWorkbook(buffer);

      await service.validateRows(rows);

      expectZeroWrites(prisma, tx);
    });
  });

  describe('commit', () => {
    it('is all-or-nothing: ONE invalid row among valid ones means zero writes (D42)', async () => {
      const buffer = await buildXlsx(HEADERS, [
        ['Valid One', 'one@example.com', null, 'reader', null],
        ['Bad Role', 'two@example.com', null, 'ghost_role', null],
        ['Valid Three', 'three@example.com', null, 'reader', null],
      ]);

      const report = await service.commit(buffer, 'importer-1');

      expect(report.allValid).toBe(false);
      expect(report.validCount).toBe(2);
      expect(report.invalidCount).toBe(1);
      expectZeroWrites(prisma, tx);
    });

    it('upserts by ID first: an externalId match is updated in place (email updated onto the SAME user)', async () => {
      usersByExternalId.set('EMP-1', { id: 'user-1', email: 'old@example.com' });
      const buffer = await buildXlsx(HEADERS, [['New Name', 'new@example.com', 'EMP-1', 'reader', 'IT']]);

      const report = await service.commit(buffer, 'importer-1');

      expect(report.allValid).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'New Name', email: 'new@example.com', externalId: 'EMP-1', department: 'IT' },
      });
      expect(tx.userRole.upsert).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 'user-1', roleId: 'role-reader' } },
        update: {},
        create: { userId: 'user-1', roleId: 'role-reader', assignedBy: 'importer-1' },
      });
      expect(tx.user.create).not.toHaveBeenCalled();
    });

    it('falls back to upsert-by-email when the row has no ID match', async () => {
      usersByEmail.set('amina@example.com', { id: 'user-2', email: 'amina@example.com' });
      const buffer = await buildXlsx(HEADERS, [['Amina Hassan', 'amina@example.com', 'EMP-9', 'reader', null]]);

      const report = await service.commit(buffer, 'importer-1');

      expect(report.allValid).toBe(true);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { name: 'Amina Hassan', email: 'amina@example.com', externalId: 'EMP-9', department: null },
      });
      expect(tx.user.create).not.toHaveBeenCalled();
    });

    it('creates unmatched rows with mustChangePassword=true and an argon2id-hashed temp password', async () => {
      const buffer = await buildXlsx(HEADERS, [['New Person', 'new@example.com', 'EMP-5', 'reader', 'Library']]);

      const report = await service.commit(buffer, 'importer-1');

      expect(report.allValid).toBe(true);
      expect(tx.user.create).toHaveBeenCalledTimes(1);
      const createArgs = tx.user.create.mock.calls[0][0] as {
        data: { name: string; email: string; externalId: string; department: string; passwordHash: string; mustChangePassword: boolean; createdBy: string };
      };
      expect(createArgs.data).toMatchObject({
        name: 'New Person',
        email: 'new@example.com',
        externalId: 'EMP-5',
        department: 'Library',
        mustChangePassword: true,
        createdBy: 'importer-1',
      });
      // Real argon2id hash of the random temp password — never a plaintext
      // or empty password on a bulk-created account.
      expect(createArgs.data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(tx.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'new-user-1', roleId: 'role-reader', assignedBy: 'importer-1' },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('generates a DIFFERENT temp password hash per created user (random, not constant)', async () => {
      const buffer = await buildXlsx(HEADERS, [
        ['Person One', 'one@example.com', null, 'reader', null],
        ['Person Two', 'two@example.com', null, 'reader', null],
      ]);

      await service.commit(buffer, 'importer-1');

      expect(tx.user.create).toHaveBeenCalledTimes(2);
      const hash1 = (tx.user.create.mock.calls[0][0] as { data: { passwordHash: string } }).data.passwordHash;
      const hash2 = (tx.user.create.mock.calls[1][0] as { data: { passwordHash: string } }).data.passwordHash;
      expect(hash1).not.toBe(hash2);
    });
  });
});
