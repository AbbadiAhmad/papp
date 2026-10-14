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
    expect(ws.getRow(1).values).toEqual([undefined, 'Code', 'Name', 'Email', 'Class', 'External ID', 'Department', 'Active', 'Date of Birth']);
    expect(ws.getRow(2).getCell(1).value).toBe('STU000001');
    expect(ws.getRow(2).getCell(7).value).toBe('yes');
  });

  it('with reading_club installed, exports Club / Club Group / Club Stage plus a reference sheet and dropdowns', async () => {
    ctx.students.list.mockResolvedValue([
      { id: 'st1', code: 'S1', name: 'Aisha', email: 'a@b.test', className: '5A', externalId: null, department: null, isActive: true, dateOfBirth: '2014-05-06' },
      { id: 'st2', code: 'S2', name: 'Omar', email: 'o@b.test', className: '5A', externalId: null, department: null, isActive: true },
    ] as never);
    const extension = {
      exportData: jest.fn(async () => ({
        members: { st1: { group: 'Eagles', stage: 'Silver' } },
        groups: [{ name: 'Eagles', stages: [{ order: 1, name: 'Bronze' }, { order: 2, name: 'Silver' }] }, { name: 'Owls', stages: [] }],
      })),
      validate: jest.fn(),
      apply: jest.fn(),
    };
    (ctx.service as unknown as { moduleRef: unknown }).moduleRef = { get: () => extension };

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await ctx.service.exportWorkbook()) as never);
    const readers = wb.getWorksheet('Readers')!;
    expect(readers.getRow(1).values).toEqual([undefined, 'Code', 'Name', 'Email', 'Class', 'External ID', 'Department', 'Active', 'Date of Birth', 'Club', 'Club Group', 'Club Stage']);
    expect([readers.getRow(2).getCell(9).value, readers.getRow(2).getCell(10).value, readers.getRow(2).getCell(11).value]).toEqual(['yes', 'Eagles', 'Silver']);
    expect([readers.getRow(3).getCell(9).value, readers.getRow(3).getCell(10).value]).toEqual(['no', '']);
    expect(readers.getCell('J2').dataValidation).toMatchObject({ type: 'list' });

    const ref = wb.getWorksheet('Club reference')!;
    expect(ref.getRow(2).getCell(1).value).toBe('Eagles');
    expect(ref.getRow(3).getCell(3).value).toBe('Silver');
    expect(ref.getRow(4).getCell(1).value).toBe('Owls');
    expect(ref.getRow(3).getCell(6).value).toBe('Silver'); // distinct stage-name dropdown list

    // The exported file feeds straight back into the import parser.
    const parsed = await ctx.service.parseWorkbook((await wb.xlsx.writeBuffer()) as never);
    expect(parsed[0]).toMatchObject({ club: true, clubGroup: 'Eagles', clubStage: 'Silver' });
    expect(parsed[1]).toMatchObject({ club: false, clubGroup: null });
  });

  it('parses the Date of Birth column (text or a real Excel date) and flags invalid / future dates', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Readers');
    ws.addRow(['Code', 'Date of Birth']);
    ws.addRow(['S1', '2014-05-06']);
    ws.addRow(['S2', new Date(Date.UTC(2013, 0, 31))]);
    ws.addRow(['S3', '31/12/2014']);
    ws.addRow(['S4', '2999-01-01']);
    ws.addRow(['S5', null]);
    const rows = await ctx.service.parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows[0].dateOfBirth).toBe('2014-05-06');
    expect(rows[1].dateOfBirth).toBe('2013-01-31');
    expect(rows[2]).toMatchObject({ dateOfBirth: null, dateOfBirthInvalid: true });
    expect(rows[3].dateOfBirthInvalid).toBe(true);
    expect(rows).toHaveLength(5);
    expect(rows[4].dateOfBirth).toBeNull(); // blank cell: an existing reader keeps theirs
  });

  it('a row with an invalid date of birth is rejected by validation', async () => {
    const report = await ctx.service.validateRows([
      { row: 2, code: 'S9', name: 'X', email: 'x@y.test', className: null, externalId: null, department: null, dateOfBirth: null, dateOfBirthInvalid: true, isActive: null, club: null, clubGroup: null, clubStage: null },
    ] as never);
    expect(report.rows[0]).toMatchObject({ valid: false });
    expect(report.rows[0].error).toMatch(/date of birth/i);
  });

  it('parses recognized columns case-insensitively and skips blank rows', async () => {
    const rows = await ctx.service.parseWorkbook(await workbookBuffer(['CODE', 'name', 'E-mail?', 'Email'], [['S1', 'Aisha', 'x', 'a@b.test'], [null, null, null, null]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ row: 2, code: 'S1', name: 'Aisha', email: 'a@b.test' });
  });

  it('parses the optional reading-club columns', async () => {
    const rows = await ctx.service.parseWorkbook(
      await workbookBuffer(['Code', 'Club', 'Club Group', 'Club Stage'], [['S1', 'yes', 'Eagles', '2'], ['S2', 'no', null, null], ['S3', 'maybe', null, null]]),
    );
    expect(rows[0]).toMatchObject({ club: true, clubGroup: 'Eagles', clubStage: '2' });
    expect(rows[1]).toMatchObject({ club: false, clubGroup: null });
    expect(rows[2]).toMatchObject({ club: null, clubInvalid: true });
  });

  it('rejects club columns when the reading_club extension is not installed, and defers to it when it is', async () => {
    ctx.prisma.libraryStudent.findMany.mockResolvedValue([{ id: 'st1', code: 'S1', userId: 'u1' }] as never);
    const rows = [{ row: 2, code: 'S1', name: null, email: null, className: null, externalId: null, department: null, isActive: null, club: true, clubGroup: 'Eagles', clubStage: null }];

    const without = await ctx.service.validateRows(rows as never);
    expect(without.rows[0]).toMatchObject({ valid: false });
    expect(without.rows[0].error).toMatch(/Reading Club module/);

    const extension = { validate: jest.fn(async () => [{ row: 2, error: 'Club group "Eagles" not found in the current episode' }]), apply: jest.fn() };
    (ctx.service as unknown as { moduleRef: unknown }).moduleRef = { get: () => extension };
    const withExt = await ctx.service.validateRows(rows as never);
    expect(withExt.rows[0].error).toMatch(/not found/);
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
