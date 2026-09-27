import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_VERSION } from '../../platform-version';

const execFileAsync = promisify(execFile);

/**
 * `archiver` is pinned to `^7` (see package.json) — v8 removed the
 * `registerFormat`/callable-factory API this AES plugin depends on, and
 * `archiver-zip-encrypted` (the only maintained AES-256-zip writer for
 * Node, confirmed by a real encrypt/decrypt round-trip test before
 * choosing it — see cli-db.ts's matching read-side note) targets that older
 * API. `@types/archiver` on npm only types the newer v8 shape, so this file
 * intentionally avoids it and calls both packages through minimal local
 * types instead of `any`.
 *
 * Loaded via a lazy dynamic `import()` (both packages are plain CJS, which
 * Node's ESM loader interops with transparently) rather than a top-level
 * `require()` — this codebase's Jest unit layer runs as real ESM
 * (`test/jest.base.config.ts`'s own docblock), where a bare `require()`
 * inside `.ts` compiled to ESM throws `ReferenceError: require is not
 * defined`. `registerFormat` is idempotent-guarded so this is safe to call
 * on every `buildEncryptedZip`.
 */
interface ArchiverInstance {
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'warning' | 'error', listener: (err: Error) => void): void;
  on(event: 'end', listener: () => void): void;
  file(filepath: string, options: { name: string }): void;
  append(source: string | Buffer, options: { name: string }): void;
  finalize(): Promise<void>;
}
interface ArchiverFactory {
  (format: string, options: Record<string, unknown>): ArchiverInstance;
  registerFormat(format: string, module: unknown): void;
  isRegisteredFormat(format: string): boolean;
}

let archiverFactory: ArchiverFactory | undefined;

async function loadArchiver(): Promise<ArchiverFactory> {
  if (archiverFactory) return archiverFactory;
  const [{ default: archiver }, { default: archiverZipEncrypted }] = await Promise.all([
    import('archiver') as Promise<{ default: ArchiverFactory }>,
    import('archiver-zip-encrypted') as Promise<{ default: unknown }>,
  ]);
  if (!archiver.isRegisteredFormat('zip-encrypted')) {
    archiver.registerFormat('zip-encrypted', archiverZipEncrypted);
  }
  archiverFactory = archiver;
  return archiver;
}

export const DUMP_MEMBER = 'dump.pgcustom';
export const SQL_DUMP_MEMBER = 'dump.sql';
export const METADATA_MEMBER = 'metadata.json';

export class BackupNotConfiguredError extends Error {
  constructor() {
    super('Database backup is not configured: BACKUP_ENCRYPTION_PASSWORD is empty.');
  }
}

export interface BackupMetadata {
  platformVersion: string;
  schemaFingerprint: string;
  exportedAt: string;
  exportedBy: string;
}

export interface BackupInfo {
  platformVersion: string;
  schemaFingerprint: string;
  backupConfigured: boolean;
}

interface DbConnParams {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
}

/**
 * Whole-database backup export (docs/DECISIONS.md D43 resolution).
 * Modeled on the user's own Research-Hub platform (`backend/app/services/
 * db_backup.py`): `pg_dump -Fc` (for pg_restore) + a plain `--clean
 * --if-exists` SQL dump (psql fallback) + metadata.json, all wrapped in an
 * AES-256-encrypted zip. Restore is deliberately NOT implemented here — see
 * `apps/api/src/cli-db.ts` and `backup.controller.ts`'s own docblock for why.
 *
 * The schema "fingerprint" is papp's equivalent of Research-Hub's Alembic
 * head revision: a sha256 over every `module_migrations` row (moduleKey +
 * filename + checksum, ordered), covering core + every installed module
 * uniformly with no per-module special-casing.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly prisma: PrismaService) {}

  isConfigured(): boolean {
    return Boolean(process.env.BACKUP_ENCRYPTION_PASSWORD);
  }

  private requireConfigured(): void {
    if (!this.isConfigured()) {
      throw new BackupNotConfiguredError();
    }
  }

  /**
   * sha256 over every applied migration's (moduleKey, filename, checksum),
   * ordered deterministically — changes whenever any module's migration set
   * changes, same purpose as an Alembic head revision.
   */
  async computeSchemaFingerprint(): Promise<string> {
    const rows = await this.prisma.moduleMigration.findMany({
      orderBy: [{ moduleKey: 'asc' }, { filename: 'asc' }],
      select: { moduleKey: true, filename: true, checksum: true },
    });
    const hash = createHash('sha256');
    for (const row of rows) {
      hash.update(`${row.moduleKey}/${row.filename}:${row.checksum}\n`);
    }
    return hash.digest('hex');
  }

  async getInfo(): Promise<BackupInfo> {
    return {
      platformVersion: PLATFORM_VERSION,
      schemaFingerprint: await this.computeSchemaFingerprint(),
      backupConfigured: this.isConfigured(),
    };
  }

  private connParams(): DbConnParams {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return {
      host: url.hostname || 'localhost',
      port: url.port || '5432',
      username: decodeURIComponent(url.username) || '',
      password: decodeURIComponent(url.password) || '',
      database: url.pathname.replace(/^\//, '') || '',
    };
  }

  /**
   * Runs both `pg_dump` invocations + builds the encrypted zip. Returns the
   * complete archive as a Buffer (small enough for this platform's expected
   * DB sizes — see the module docblock's "not for huge datasets" note if
   * this ever needs to become a stream).
   */
  async exportBackup(actorLabel: string): Promise<Buffer> {
    this.requireConfigured();
    const conn = this.connParams();
    const env = { ...process.env, PGPASSWORD: conn.password };

    const workDir = mkdtempSync(join(tmpdir(), 'papp-backup-'));
    try {
      const customDumpPath = join(workDir, DUMP_MEMBER);
      const sqlDumpPath = join(workDir, SQL_DUMP_MEMBER);

      await this.runPgDump(
        ['-h', conn.host, '-p', conn.port, '-U', conn.username, '-Fc', '-f', customDumpPath, conn.database],
        env,
      );
      await this.runPgDump(
        [
          '-h', conn.host, '-p', conn.port, '-U', conn.username,
          '--format=plain', '--clean', '--if-exists',
          '-f', sqlDumpPath, conn.database,
        ],
        env,
      );

      const metadata: BackupMetadata = {
        platformVersion: PLATFORM_VERSION,
        schemaFingerprint: await this.computeSchemaFingerprint(),
        exportedAt: new Date().toISOString(),
        exportedBy: actorLabel,
      };

      return await this.buildEncryptedZip(customDumpPath, sqlDumpPath, metadata);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  private async runPgDump(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    try {
      await execFileAsync('pg_dump', args, { env });
    } catch (error) {
      const stderr = error instanceof Error && 'stderr' in error ? String((error as { stderr?: unknown }).stderr) : '';
      this.logger.error(`pg_dump failed: ${stderr || (error instanceof Error ? error.message : String(error))}`);
      throw new Error(`pg_dump failed: ${stderr || (error instanceof Error ? error.message : String(error))}`, { cause: error });
    }
  }

  private async buildEncryptedZip(customDumpPath: string, sqlDumpPath: string, metadata: BackupMetadata): Promise<Buffer> {
    const archiver = await loadArchiver();
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip-encrypted', {
        zlib: { level: 9 },
        encryptionMethod: 'aes256',
        password: process.env.BACKUP_ENCRYPTION_PASSWORD,
      });

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('warning', (warning) => this.logger.warn(`archiver warning: ${warning.message}`));
      archive.on('error', (error) => reject(error));
      archive.on('end', () => resolve(Buffer.concat(chunks)));

      archive.file(customDumpPath, { name: DUMP_MEMBER });
      archive.file(sqlDumpPath, { name: SQL_DUMP_MEMBER });
      archive.append(JSON.stringify(metadata), { name: METADATA_MEMBER });
      void archive.finalize();
    });
  }
}
