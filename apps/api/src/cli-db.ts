/**
 * `node dist/cli-db.js restore <file>` — the ONLY way to restore a papp
 * database backup (docs/DECISIONS.md D43 resolution). Deliberately outside
 * the running NestJS app entirely (no Nest bootstrap, no DI, no HTTP): a real
 * `pg_restore --clean` needs an exclusive lock that queues behind (and
 * queues other requests behind) any connection the app's own Prisma pool
 * holds. In the reference implementation this was ported from, attempting a
 * restore through the HTTP API made the whole app — including login — hang
 * and time out. Run via `scripts/manageDB.sh restore <file>`, which wraps
 * `docker compose exec -T api node dist/cli-db.js restore` so this always
 * runs in the `api` container against the real `DATABASE_URL`, never against
 * a developer's local Postgres by accident.
 *
 * `<file>` may be the AES-encrypted `.zip` BackupService produces, or a raw,
 * unencrypted `.sql` file (sniffed by magic bytes) for a manually-prepared
 * dump — the raw-SQL path skips the schema-fingerprint check entirely since
 * there is no metadata.json to read it from.
 *
 * The schema-fingerprint check (papp's equivalent of Research-Hub's Alembic
 * head-revision check) is advisory only: a mismatch is printed as a loud
 * warning, not a blocking error. Unlike the HTTP export path, this is a
 * human running a script, not an API call that can cleanly 409 — the
 * operator decides whether to proceed.
 */
import { BlobReader, BlobWriter, ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js';
import { execFile } from 'node:child_process';
import { Client } from 'pg';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DUMP_MEMBER = 'dump.pgcustom';
const SQL_DUMP_MEMBER = 'dump.sql';
const METADATA_MEMBER = 'metadata.json';
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

interface BackupMetadata {
  platformVersion: string;
  schemaFingerprint: string;
  exportedAt: string;
  exportedBy: string;
}

interface DbConnParams {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
}

function connParams(): DbConnParams {
  const url = new URL(process.env.DATABASE_URL ?? '');
  return {
    host: url.hostname || 'localhost',
    port: url.port || '5432',
    username: decodeURIComponent(url.username) || '',
    password: decodeURIComponent(url.password) || '',
    database: url.pathname.replace(/^\//, '') || '',
  };
}

/** sha256 over every applied migration's (moduleKey, filename, checksum) — must match BackupService.computeSchemaFingerprint exactly. */
async function currentSchemaFingerprint(conn: DbConnParams): Promise<string> {
  const { createHash } = await import('node:crypto');
  const client = new Client({
    host: conn.host,
    port: Number(conn.port),
    user: conn.username,
    password: conn.password,
    database: conn.database,
  });
  await client.connect();
  try {
    const result = await client.query<{ module_key: string; filename: string; checksum: string }>(
      'SELECT module_key, filename, checksum FROM module_migrations ORDER BY module_key ASC, filename ASC',
    );
    const hash = createHash('sha256');
    for (const row of result.rows) {
      hash.update(`${row.module_key}/${row.filename}:${row.checksum}\n`);
    }
    return hash.digest('hex');
  } finally {
    await client.end();
  }
}

async function terminateOtherConnections(conn: DbConnParams): Promise<void> {
  const client = new Client({
    host: conn.host,
    port: Number(conn.port),
    user: conn.username,
    password: conn.password,
    database: 'postgres',
  });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [conn.database],
    );
  } finally {
    await client.end();
  }
}

async function restoreViaCustomDump(dumpBytes: Buffer, conn: DbConnParams): Promise<void> {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const workDir = mkdtempSync(join(tmpdir(), 'papp-restore-'));
  const dumpPath = join(workDir, 'dump.pgcustom');
  try {
    writeFileSync(dumpPath, dumpBytes);
    const env = { ...process.env, PGPASSWORD: conn.password };
    await execFileAsync(
      'pg_restore',
      ['-h', conn.host, '-p', conn.port, '-U', conn.username, '-d', conn.database, '--clean', '--if-exists', '--no-owner', '--no-privileges', dumpPath],
      { env },
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function restoreViaPsql(sqlBytes: Buffer, conn: DbConnParams): Promise<void> {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const workDir = mkdtempSync(join(tmpdir(), 'papp-restore-'));
  const sqlPath = join(workDir, 'dump.sql');
  try {
    writeFileSync(sqlPath, sqlBytes);
    const env = { ...process.env, PGPASSWORD: conn.password };
    await execFileAsync(
      'psql',
      ['-h', conn.host, '-p', conn.port, '-U', conn.username, '-d', conn.database, '--set=ON_ERROR_STOP=1', '-f', sqlPath],
      { env },
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Reads and decrypts one entry as a Buffer via zip.js's async Blob-based API
 * — the AES-256 (WinZip-style) format `archiver-zip-encrypted` writes is NOT
 * readable by `adm-zip`/`node-stream-zip` (both only support legacy
 * ZipCrypto), confirmed by a real round-trip test before choosing this
 * library; `@zip.js/zip.js` is the one verified to decrypt it correctly,
 * including binary content.
 */
function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

async function readEncryptedEntry(entry: Entry, password: string): Promise<Buffer> {
  if (!isFileEntry(entry)) throw new Error(`Zip entry ${entry.filename} is a directory, not a file.`);
  const blob = await entry.getData(new BlobWriter(), { password });
  return Buffer.from(await blob.arrayBuffer());
}

async function restoreEncryptedArchive(fileBytes: Buffer, conn: DbConnParams): Promise<void> {
  const password = process.env.BACKUP_ENCRYPTION_PASSWORD;
  if (!password) {
    throw new Error('BACKUP_ENCRYPTION_PASSWORD is not set — cannot decrypt the backup archive.');
  }

  const reader = new ZipReader(new BlobReader(new Blob([Uint8Array.from(fileBytes)])), { password });
  let entries: Awaited<ReturnType<typeof reader.getEntries>>;
  try {
    entries = await reader.getEntries();
  } catch (error) {
    throw new Error(`Not a valid zip archive: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  const metadataEntry = entries.find((e) => e.filename === METADATA_MEMBER);
  const dumpEntry = entries.find((e) => e.filename === DUMP_MEMBER);
  const sqlEntry = entries.find((e) => e.filename === SQL_DUMP_MEMBER);
  if (!metadataEntry || !dumpEntry) {
    await reader.close();
    throw new Error('Invalid backup archive: missing expected members.');
  }

  let metadata: BackupMetadata;
  try {
    const metadataBytes = await readEncryptedEntry(metadataEntry, password);
    metadata = JSON.parse(metadataBytes.toString('utf8')) as BackupMetadata;
  } catch (error) {
    await reader.close();
    throw new Error(`Failed to read/decrypt metadata.json (wrong password?): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  const currentFingerprint = await currentSchemaFingerprint(conn);
  if (metadata.schemaFingerprint !== currentFingerprint) {
    console.warn('');
    console.warn('*** WARNING: schema fingerprint mismatch ***');
    console.warn(`  archive:  ${metadata.schemaFingerprint}`);
    console.warn(`  current:  ${currentFingerprint}`);
    console.warn('  This backup was taken against a different set of applied migrations.');
    console.warn('  Restoring anyway — this is advisory only, not blocking. Proceeding in 5s (Ctrl+C to abort)...');
    console.warn('');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log(`Terminating other connections to database "${conn.database}"...`);
  await terminateOtherConnections(conn);

  const dumpBytes = await readEncryptedEntry(dumpEntry, password);

  try {
    console.log('Restoring via pg_restore (custom format)...');
    await restoreViaCustomDump(dumpBytes, conn);
    console.log('Restore complete (pg_restore).');
  } catch (error) {
    if (!sqlEntry) {
      await reader.close();
      throw new Error(`pg_restore failed and no SQL fallback is present in the archive: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    console.warn(`pg_restore failed (${error instanceof Error ? error.message : String(error)}) — falling back to psql SQL dump.`);
    const sqlBytes = await readEncryptedEntry(sqlEntry, password);
    await restoreViaPsql(sqlBytes, conn);
    console.log('Restore complete (psql fallback).');
  } finally {
    await reader.close();
  }
}

async function restoreRawSql(sqlBytes: Buffer, conn: DbConnParams): Promise<void> {
  console.warn('Restoring from a raw, unencrypted .sql file — no metadata, schema-fingerprint check skipped.');
  console.log(`Terminating other connections to database "${conn.database}"...`);
  await terminateOtherConnections(conn);
  await restoreViaPsql(sqlBytes, conn);
  console.log('Restore complete (psql).');
}

async function main(): Promise<void> {
  const [command, file] = process.argv.slice(2);
  if (command !== 'restore' || !file) {
    console.error('Usage: node dist/cli-db.js restore <file>');
    process.exit(1);
  }

  const { readFileSync } = await import('node:fs');
  const fileBytes = readFileSync(file);
  const conn = connParams();

  const isZip = fileBytes.subarray(0, 4).equals(ZIP_MAGIC);
  if (isZip) {
    await restoreEncryptedArchive(fileBytes, conn);
  } else {
    await restoreRawSql(fileBytes, conn);
  }
}

main().catch((error) => {
  console.error('Restore FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
