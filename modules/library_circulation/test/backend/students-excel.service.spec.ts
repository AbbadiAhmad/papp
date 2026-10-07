import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import { StudentsExcelService } from '../../backend/students-excel.service';

async function workbookBuffer(header: string[], rows: (string | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Readers');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildService() {
  const students = {
    list: jest.fn(),
    syncReaderProfiles: jest.fn(async () => undefined),
    allocateCode: jest.fn(),
    reconcileCodeSequence: jest.fn(),
  };
  const prisma = {
    libraryStudent: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    role: { findUnique: jest.fn() },
  };
  const service = new StudentsExcelService(students as never);
  (service as unknown as { prisma: unknown }).prisma = prisma;
  return { service, students, prisma };
}

const HEADER = ['Code', 'Name', 'Email', 'Class'];

describe('StudentsExcelService', () => {
  let ctx: ReturnType<typeof buildService>;
  beforeEach(() => {
    ctx = buildService();
    ctx.prisma.libraryStudent.findMany.mockResolvedValue([] as never);
    ctx.prisma.user.findMany.mockResolvedValue([] as never);
  });

  it('exports the readers list as an .xlsx with the import-compatible header', async () => {
    ctx.students.list.mockResolvedValue([
      { code: 'STU000001', name: 'Aisha', email: 'a@b.test', className: '5A', externalId: null, department: null, isActive: true },
    ] as never);
    const buffer = await ctx.service.exportWorkbook();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).values).toEqual([undefined, 'Code', 'Name', 'Email', 'Class', 'External ID', 'Department', 'Active']);
    expect(ws.getRow(2).getCell(1).value).toBe('STU000001');
    expect(ws.getRow(2).getCell(7).value).toBe('yes');
  });

  it('parses recognized columns case-insensitively and skips blank rows', async () => {
    const rows = await ctx.service.parseWorkbook(await workbookBuffer(['CODE', 'name', 'E-mail?', 'Email'], [['S1', 'Aisha', 'x', 'a@b.test'], [null, null, null, null]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ row: 2, code: 'S1', name: 'Aisha', email: 'a@b.test' });
  });

  it('rejects a file with no recognizable header', async () => {
    await expect(ctx.service.parseWorkbook(await workbookBuffer(['foo', 'bar'], [['1', '2']]))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a new reader with a blank code is a valid create (code is auto-assigned at commit)', async () => {
    const report = await ctx.service.validateRows(await ctx.service.parseWorkbook(await workbookBuffer(HEADER, [[null, 'Aisha', 'a@b.test', '5A']])));
    expect(report.allValid).toBe(true);
    expect(report.rows[0]).toMatchObject({ action: 'create', code: null });
    expect(ctx.students.syncReaderProfiles).toHaveBeenCalled(); // self-registered readers must be matchable
  });

  it('matches an existing reader by code (update) and by email', async () => {
    ctx.prisma.libraryStudent.findMany
      .mockResolvedValueOnce([{ id: 's1', userId: 'u1', code: 'STU000001' }] as never) // by code
      .mockResolvedValueOnce([{ id: 's2', userId: 'u2', code: 'STU000002' }] as never); // by user id
    ctx.prisma.user.findMany.mockResolvedValue([{ id: 'u2', email: 'two@b.test' }] as never);
    const report = await ctx.service.validateRows(
      await ctx.service.parseWorkbook(await workbookBuffer(HEADER, [['STU000001', 'One', null, null], [null, null, 'two@b.test', '6B']])),
    );
    expect(report.rows.map((r) => [r.action, r.matchedStudentId])).toEqual([['update', 's1'], ['update', 's2']]);
  });

  it.each([
    ['missing name on a new reader', [[null, null, 'a@b.test', null]], 'Name is required'],
    ['invalid email', [['C1', 'A', 'not-an-email', null]], 'Invalid email'],
    ['row with neither code nor email', [[null, 'A', null, null]], 'Code or an Email'],
    ['duplicate code in the file', [['C1', 'A', 'a@b.test', null], ['C1', 'B', 'b@b.test', null]], 'Duplicate code'],
    ['duplicate email in the file', [['C1', 'A', 'a@b.test', null], ['C2', 'B', 'A@b.test', null]], 'Duplicate email'],
  ])('flags %s', async (_label, data, message) => {
    const report = await ctx.service.validateRows(await ctx.service.parseWorkbook(await workbookBuffer(HEADER, data as (string | null)[][])));
    expect(report.allValid).toBe(false);
    expect(report.rows.some((r) => r.error?.includes(message))).toBe(true);
  });

  it('rejects an email that belongs to a non-reader account', async () => {
    ctx.prisma.user.findMany.mockResolvedValue([{ id: 'staff', email: 'staff@b.test' }] as never);
    const report = await ctx.service.validateRows(await ctx.service.parseWorkbook(await workbookBuffer(HEADER, [[null, 'Staff', 'staff@b.test', null]])));
    expect(report.rows[0].error).toContain('not a reader');
  });

  it('commit writes nothing when any row is invalid', async () => {
    const report = await ctx.service.commit(await workbookBuffer(HEADER, [[null, null, 'bad', null]]), 'admin-1');
    expect(report.allValid).toBe(false);
    expect(ctx.prisma.role.findUnique).not.toHaveBeenCalled();
  });
});
