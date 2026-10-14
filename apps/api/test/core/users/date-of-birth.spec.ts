import { describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';
import { formatDateOnly, normalizeDateOfBirth, toDateOnly } from '../../../src/core/users/date-of-birth.util';
import { ExcelImportService } from '../../../src/core/users/excel-import.service';

describe('date of birth', () => {
  const today = new Date('2026-10-14T12:00:00Z');

  it('accepts only real calendar dates between 1900 and today', () => {
    expect(normalizeDateOfBirth('2014-05-06', today)).toBe('2014-05-06');
    expect(normalizeDateOfBirth(' 2026-10-14 ', today)).toBe('2026-10-14');
    expect(normalizeDateOfBirth('2026-10-15', today)).toBeNull(); // future
    expect(normalizeDateOfBirth('1899-12-31', today)).toBeNull();
    expect(normalizeDateOfBirth('2020-02-31', today)).toBeNull(); // not a day
    expect(normalizeDateOfBirth('06/05/2014', today)).toBeNull(); // ambiguous formats are refused
  });

  it('round-trips through the date-only column type without a time-zone shift', () => {
    expect(formatDateOnly(toDateOnly('2014-05-06'))).toBe('2014-05-06');
    expect(formatDateOnly(null)).toBeNull();
  });

  describe('users Excel import/export', () => {
    const service = new ExcelImportService({} as never);
    async function sheet(headers: string[], row: unknown[]) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Users');
      ws.addRow(headers);
      ws.addRow(row);
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    it('reads a "date of birth" column from text or an Excel date and flags a bad one', async () => {
      const ok = await service.parseWorkbook(await sheet(['name', 'email', 'role', 'Date of Birth'], ['A', 'a@x.test', 'reader', new Date(Date.UTC(2013, 0, 31))]));
      expect(ok[0].dateOfBirth).toBe('2013-01-31');
      const bad = await service.parseWorkbook(await sheet(['name', 'email', 'role', 'dob'], ['A', 'a@x.test', 'reader', 'yesterday']));
      expect(bad[0].dateOfBirthInvalid).toBe(true);
    });

    it('a file WITHOUT the column leaves dateOfBirth undefined, so an update never wipes stored values', async () => {
      const rows = await service.parseWorkbook(await sheet(['name', 'email', 'role'], ['A', 'a@x.test', 'reader']));
      expect(rows[0].dateOfBirth).toBeUndefined();
    });

    it('exports a date of birth column', async () => {
      const prisma = {
        user: { findMany: async () => [{ name: 'A', email: 'a@x.test', externalId: null, department: null, dateOfBirth: new Date('2014-05-06T00:00:00Z'), userRoles: [] }] },
      };
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await new ExcelImportService(prisma as never).exportUsers()) as never);
      const ws = wb.worksheets[0];
      expect(ws.getRow(1).getCell(6).value).toBe('date of birth');
      expect(ws.getRow(2).getCell(6).value).toBe('2014-05-06');
    });
  });
});
