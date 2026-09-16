import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { ExcelImportService } from '../../../src/core/users/excel-import.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';

/**
 * Tier 2: ExcelImportService.commit()'s TRANSACTION behavior against a REAL
 * database — this is exactly what Tier 1's mocked-Prisma
 * `excel-import.service.spec.ts` cannot prove (a mock can be told
 * `$transaction` "succeeded" without ever proving nothing partially
 * committed). Two things only a real DB round-trip demonstrates:
 *   1. all-or-nothing: one bad row among valid ones -> ZERO rows written.
 *   2. upsert-by-ID genuinely UPDATES the existing row rather than creating
 *      a duplicate.
 */
describe('ExcelImportService.commit() (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let importService: ExcelImportService;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    importService = app.get(ExcelImportService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  async function buildWorkbookBuffer(
    rows: Array<{ name?: string; email?: string; id?: string; role?: string; department?: string }>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Users');
    worksheet.addRow(['name', 'email', 'id', 'role', 'department']);
    for (const row of rows) {
      worksheet.addRow([row.name ?? null, row.email ?? null, row.id ?? null, row.role ?? null, row.department ?? null]);
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  it('is all-or-nothing: one invalid row among valid ones commits ZERO rows to the DB', async () => {
    const before = await prisma.user.count();
    const emailA = `${randomUUID()}@example.com`;
    const emailB = `${randomUUID()}@example.com`;

    const buffer = await buildWorkbookBuffer([
      { name: 'Valid One', email: emailA, role: 'reader' },
      { name: '', email: emailB, role: 'reader' }, // missing name -> invalid row
    ]);

    const report = await importService.commit(buffer, randomUUID());

    expect(report.allValid).toBe(false);
    expect(report.invalidCount).toBe(1);

    const after = await prisma.user.count();
    expect(after).toBe(before); // real transaction rollback, not a partial commit

    const createdA = await prisma.user.findUnique({ where: { email: emailA } });
    expect(createdA).toBeNull();
  });

  it('upsert-by-ID genuinely UPDATES the matched row in place (no duplicate created)', async () => {
    const externalId = `EMP-${randomUUID()}`;
    const passwordHash = await argon2.hash('whatever-password', { type: argon2.argon2id });
    const existing = await prisma.user.create({
      data: {
        email: `old-${randomUUID()}@example.com`,
        name: 'Old Name',
        externalId,
        department: 'Old Dept',
        passwordHash,
      },
    });

    const before = await prisma.user.count();
    const newEmail = `new-${randomUUID()}@example.com`;
    const buffer = await buildWorkbookBuffer([
      { name: 'New Name', email: newEmail, id: externalId, role: 'reader', department: 'New Dept' },
    ]);

    const report = await importService.commit(buffer, randomUUID());

    expect(report.allValid).toBe(true);
    expect(report.rows[0].action).toBe('update');
    expect(report.rows[0].matchedUserId).toBe(existing.id);

    const after = await prisma.user.count();
    expect(after).toBe(before); // no new row created

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.name).toBe('New Name');
    expect(updated.email).toBe(newEmail);
    expect(updated.department).toBe('New Dept');

    const roleRow = await prisma.role.findUniqueOrThrow({ where: { code: 'reader' } });
    const userRole = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: existing.id, roleId: roleRow.id } },
    });
    expect(userRole).not.toBeNull();
  });
});
