import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { ALL_ROLE_CODES, expectPermissionEnforced, fixtureForRole } from '../../../../../test/support/permission-matrix';

/** The "Export files" endpoint: permission matrix, the not-configured states, and a real streamed download. */
describe('Backup: export files (e2e)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;
  const work = mkdtempSync(join(tmpdir(), 'backup-files-e2e-'));
  const saved = { pw: process.env.BACKUP_ENCRYPTION_PASSWORD, dirs: process.env.BACKUP_FILE_DIRS };

  beforeAll(async () => {
    mkdirSync(join(work, 'books'), { recursive: true });
    writeFileSync(join(work, 'books', 'a.txt'), 'hello');
    process.env.BACKUP_ENCRYPTION_PASSWORD = 'e2e-secret';
    process.env.BACKUP_FILE_DIRS = `books_files=${join(work, 'books')}`;
    container = await startPostgresTestContainer();
    app = await createTestApp();
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
    process.env.BACKUP_ENCRYPTION_PASSWORD = saved.pw;
    process.env.BACKUP_FILE_DIRS = saved.dirs;
    rmSync(work, { recursive: true, force: true });
  });

  describe('permission matrix (backup.export)', () => {
    expectPermissionEnforced({
      app: () => app!,
      method: 'post',
      path: '/backup/export-files',
      requiredPermission: 'backup.export',
      expectedSuccessStatus: 201,
    });
  });

  it('GET /backup/info lists the configured file directories', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const res = await request(app!.getHttpServer()).get('/backup/info').set('Authorization', `Bearer ${admin.token}`);
    expect(res.body.fileRoots).toEqual(['books_files']);
  });

  it('streams a zip download, and answers 409 when no directory is configured', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const ok = await request(app!.getHttpServer())
      .post('/backup/export-files')
      .set('Authorization', `Bearer ${admin.token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(ok.status).toBe(201);
    expect(ok.headers['content-disposition']).toContain('papp-files-');
    expect((ok.body as Buffer).subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect((ok.body as Buffer).includes(Buffer.from('hello'))).toBe(false); // encrypted, not stored in the clear

    process.env.BACKUP_FILE_DIRS = '';
    const none = await request(app!.getHttpServer()).post('/backup/export-files').set('Authorization', `Bearer ${admin.token}`);
    expect(none.status).toBe(409);
    process.env.BACKUP_FILE_DIRS = `books_files=${join(work, 'books')}`;
  });

  it('audits the export as core.backup / export_files, without any file contents (TESTING_STRATEGY §3)', async () => {
    const rows = await app!.get(PrismaService).$queryRawUnsafe<Array<{ category: string; entity_type: string; new_value: unknown }>>(
      `SELECT category, entity_type, new_value FROM audit_log WHERE action = 'export_files'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ category: 'core.backup', entity_type: 'Files' });
    expect(JSON.stringify(rows.map((r) => r.new_value))).not.toContain('hello');
  });
});
