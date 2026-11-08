import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { strFromU8, unzipSync } from 'fflate';
import { buildXlsx, readXlsx } from '../../backend/xlsx-io';
import { StudentsExcelService } from '../../backend/students-excel.service';

async function workbookBuffer(header: string[], rows: (string | null)[][]): Promise<Buffer> {
  return buildXlsx([{ name: 'Readers', header, rows }]);
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
    const ws = (await readXlsx(buffer))[0];
    expect(ws.rows[0]).toEqual(['Code', 'Name', 'Email', 'Class', 'External ID', 'Department', 'Active', 'Date of Birth']);
    expect(ws.rows[1][0]).toBe('STU000001');
    expect(ws.rows[1][6]).toBe('yes');
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

    const exported = await ctx.service.exportWorkbook();
    const sheets = await readXlsx(exported);
    const readers = sheets.find((s) => s.name === 'Readers')!.rows;
    expect(readers[0]).toEqual(['Code', 'Name', 'Email', 'Class', 'External ID', 'Department', 'Active', 'Date of Birth', 'Club', 'Club Group', 'Club Stage']);
    expect([readers[1][8], readers[1][9], readers[1][10]]).toEqual(['yes', 'Eagles', 'Silver']);
    expect([readers[2][8], readers[2][9]]).toEqual(['no', null]);
    // Dropdowns: yes/no on Active, and the group / stage lists read from the reference sheet.
    const sheetXml = strFromU8(unzipSync(new Uint8Array(exported))['xl/worksheets/sheet1.xml']);
    expect(sheetXml).toMatch(/sqref="I2:I\d+"><formula1>"yes,no"<\/formula1>/);
    expect(sheetXml).toMatch(/sqref="J2:J\d+"><formula1>'Club reference'!\$E\$2:\$E\$\d+<\/formula1>/);
    expect(sheetXml).toMatch(/sqref="K2:K\d+"><formula1>'Club reference'!\$F\$2:\$F\$\d+<\/formula1>/);

    const ref = sheets.find((s) => s.name === 'Club reference')!.rows;
    expect(ref[1][0]).toBe('Eagles');
    expect(ref[2][2]).toBe('Silver');
    expect(ref[3][0]).toBe('Owls');
    expect(ref[2][5]).toBe('Silver'); // distinct stage-name dropdown list

    // The exported file feeds straight back into the import parser.
    const parsed = await ctx.service.parseWorkbook(exported);
    expect(parsed[0]).toMatchObject({ club: true, clubGroup: 'Eagles', clubStage: 'Silver' });
    expect(parsed[1]).toMatchObject({ club: false, clubGroup: null });
  });

  it('parses the Date of Birth column (text or a real Excel date) and flags invalid / future dates', async () => {
    const file = await buildXlsx([
      {
        name: 'Readers',
        header: ['Code', 'Date of Birth'],
        rows: [['S1', '2014-05-06'], ['S2', new Date(Date.UTC(2013, 0, 31))], ['S3', '31/12/2014'], ['S4', '2999-01-01'], ['S5', 'x']],
      },
    ]);
    const rows = await ctx.service.parseWorkbook(file);
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
