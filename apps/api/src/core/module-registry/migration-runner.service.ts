import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Applies a module's `*.sql` migration files, in filename order, tracking
 * what's been applied in `module_migrations` (moduleKey + filename + a
 * sha256 checksum of the file's contents).
 *
 * Rules (see docs/BUILD_PLAN.md, Phase 0, and D16 in docs/DECISIONS.md):
 *  - Files already recorded for this moduleKey are skipped — UNLESS the
 *    file's current checksum no longer matches what was recorded, in which
 *    case this throws. A shipped migration must never be silently re-applied
 *    or silently skipped after being edited; that's a bug in the codebase
 *    (someone edited a migration after it shipped) and must fail loudly.
 *  - Migration SQL is executed with a plain `pg` client rather than Prisma
 *    (`$executeRawUnsafe`), because a migration file is free to contain
 *    multiple statements (e.g. CREATE TABLE + CREATE INDEX), which Prisma's
 *    raw-query methods do not reliably support in one call. Prisma is only
 *    used here to read/write the `module_migrations` bookkeeping rows.
 */
@Injectable()
export class MigrationRunnerService {
  private readonly logger = new Logger(MigrationRunnerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Applies every `*.sql` file in `dir`, sorted by filename, for the given
   * `moduleKey`. Idempotent: safe to call on every boot.
   */
  async applyDirectory(dir: string, moduleKey: string): Promise<void> {
    const filenames = readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const filename of filenames) {
      await this.applyFile(dir, moduleKey, filename);
    }
  }

  private async applyFile(dir: string, moduleKey: string, filename: string): Promise<void> {
    const contents = readFileSync(join(dir, filename), 'utf8');
    const checksum = this.checksumOf(contents);

    const existing = await this.prisma.moduleMigration.findUnique({
      where: { moduleKey_filename: { moduleKey, filename } },
    });

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Migration checksum mismatch for "${filename}" (module "${moduleKey}"): ` +
            `it was applied previously with checksum ${existing.checksum}, but the file on ` +
            `disk now checksums to ${checksum}. An already-applied migration must never be ` +
            'edited — ship the change as a new migration file instead.',
        );
      }
      this.logger.debug(`Skipping already-applied migration ${moduleKey}/${filename}`);
      return;
    }

    this.logger.log(`Applying migration ${moduleKey}/${filename}`);
    await this.executeSql(contents);

    await this.prisma.moduleMigration.create({
      data: { moduleKey, filename, checksum },
    });
  }

  private checksumOf(contents: string): string {
    return createHash('sha256').update(contents, 'utf8').digest('hex');
  }

  private async executeSql(sql: string): Promise<void> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }
}
