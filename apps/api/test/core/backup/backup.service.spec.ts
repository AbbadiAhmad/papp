import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * Tier 1 (mocked dependencies, no real Postgres/subprocess — docs/TESTING_STRATEGY.md
 * §0/D37): covers the configured/unconfigured gate, the schema-fingerprint
 * hash, and that `pg_dump` is invoked with the arguments BackupService
 * documents. The real `pg_dump`/AES-zip/decrypt round trip is verified by a
 * manual smoke test against a real dev Postgres (see this feature's PR
 * description), not by this file — `execFile` is mocked here, so it can
 * never catch a real pg_dump/archiver-zip-encrypted integration break.
 */

const execFileMock = jest.fn<(...args: unknown[]) => void>();

jest.unstable_mockModule('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

const { BackupService, BackupNotConfiguredError } = await import('../../../src/core/backup/backup.service');

interface MockPrisma {
  moduleMigration: { findMany: jest.Mock };
}

function createMockPrisma(): MockPrisma {
  return { moduleMigration: { findMany: jest.fn() } };
}

describe('BackupService', () => {
  let prisma: MockPrisma;
  let service: InstanceType<typeof BackupService>;
  const originalPassword = process.env.BACKUP_ENCRYPTION_PASSWORD;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new BackupService(prisma as never);
    execFileMock.mockReset();
    process.env.DATABASE_URL = 'postgresql://papp:papp@localhost:5432/papp?schema=public';
  });

  afterAll(() => {
    process.env.BACKUP_ENCRYPTION_PASSWORD = originalPassword;
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  describe('isConfigured / requireConfigured', () => {
    it('reports unconfigured when BACKUP_ENCRYPTION_PASSWORD is empty', () => {
      delete process.env.BACKUP_ENCRYPTION_PASSWORD;
      expect(service.isConfigured()).toBe(false);
    });

    it('reports configured when BACKUP_ENCRYPTION_PASSWORD is set', () => {
      process.env.BACKUP_ENCRYPTION_PASSWORD = 'a-real-secret';
      expect(service.isConfigured()).toBe(true);
    });

    it('exportBackup rejects with BackupNotConfiguredError when unconfigured, without touching pg_dump', async () => {
      delete process.env.BACKUP_ENCRYPTION_PASSWORD;
      await expect(service.exportBackup('user-1')).rejects.toBeInstanceOf(BackupNotConfiguredError);
      expect(execFileMock).not.toHaveBeenCalled();
    });
  });

  describe('computeSchemaFingerprint', () => {
    it('is deterministic for the same migration rows regardless of DB return order variance in content', async () => {
      prisma.moduleMigration.findMany.mockResolvedValue([
        { moduleKey: 'core', filename: '0001_x.sql', checksum: 'abc' },
        { moduleKey: 'library_catalog', filename: '0001_y.sql', checksum: 'def' },
      ]);
      const first = await service.computeSchemaFingerprint();
      const second = await service.computeSchemaFingerprint();
      expect(first).toEqual(second);
      expect(first).toMatch(/^[a-f0-9]{64}$/);
    });

    it('changes when the underlying migration set changes', async () => {
      prisma.moduleMigration.findMany.mockResolvedValueOnce([{ moduleKey: 'core', filename: '0001_x.sql', checksum: 'abc' }]);
      const before = await service.computeSchemaFingerprint();

      prisma.moduleMigration.findMany.mockResolvedValueOnce([
        { moduleKey: 'core', filename: '0001_x.sql', checksum: 'abc' },
        { moduleKey: 'core', filename: '0002_y.sql', checksum: 'xyz' },
      ]);
      const after = await service.computeSchemaFingerprint();

      expect(after).not.toEqual(before);
    });

    it('queries ordered by moduleKey then filename, so the hash never depends on DB row order', async () => {
      prisma.moduleMigration.findMany.mockResolvedValue([]);
      await service.computeSchemaFingerprint();
      expect(prisma.moduleMigration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ moduleKey: 'asc' }, { filename: 'asc' }] }),
      );
    });
  });

  describe('getInfo', () => {
    it('reports platformVersion, schemaFingerprint and backupConfigured together', async () => {
      process.env.BACKUP_ENCRYPTION_PASSWORD = 'secret';
      prisma.moduleMigration.findMany.mockResolvedValue([]);

      const info = await service.getInfo();

      expect(info.backupConfigured).toBe(true);
      expect(typeof info.platformVersion).toBe('string');
      expect(info.schemaFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('exportBackup pg_dump invocation', () => {
    beforeEach(() => {
      process.env.BACKUP_ENCRYPTION_PASSWORD = 'secret';
      prisma.moduleMigration.findMany.mockResolvedValue([]);
      // execFile(cmd, args, options, callback) — resolve immediately as if
      // pg_dump succeeded and wrote its output file (we don't touch the real
      // filesystem/Postgres here, per this file's own Tier 1 scope note).
      execFileMock.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
        callback(null, { stdout: '', stderr: '' });
      });
    });

    it('invokes pg_dump twice: once -Fc (custom format), once --format=plain --clean --if-exists', async () => {
      // The zip step will still fail (no real files on disk for archiver to
      // read) — that's fine, this test only asserts pg_dump's OWN two calls
      // happened with the documented arguments before that later failure.
      await service.exportBackup('user-1').catch(() => undefined);

      expect(execFileMock).toHaveBeenCalledTimes(2);

      const [firstCall, secondCall] = execFileMock.mock.calls;
      expect(firstCall[0]).toBe('pg_dump');
      expect(firstCall[1]).toEqual(expect.arrayContaining(['-Fc']));

      expect(secondCall[0]).toBe('pg_dump');
      expect(secondCall[1]).toEqual(expect.arrayContaining(['--format=plain', '--clean', '--if-exists']));
    });

    it('parses DATABASE_URL into discrete -h/-p/-U/database args', async () => {
      await service.exportBackup('user-1').catch(() => undefined);

      const [firstCall] = execFileMock.mock.calls;
      const args = firstCall[1] as string[];
      expect(args).toEqual(expect.arrayContaining(['-h', 'localhost', '-p', '5432', '-U', 'papp', 'papp']));
    });
  });
});
