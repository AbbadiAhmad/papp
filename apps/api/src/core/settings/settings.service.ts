import { Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogWriter } from '../audit/audit-log.writer';

/**
 * `system_settings` read/write service (ARCHITECTURE.md §6.3).
 *
 * Phase 4 upgrade: `get()` now serves from an in-memory cache after the
 * first read of each key ("read through a small cached settings service"),
 * and `set()` invalidates that key after the DB write, so read-after-write
 * is always consistent within this process. Only successful lookups are
 * cached — a missing key keeps throwing on every call (it is a seeding
 * bug, not a cacheable fact). Single-process cache is sufficient for the
 * single-`api`-container docker-compose topology (D5); if the api is ever
 * scaled out, invalidation needs a cross-process signal — flagged in the
 * Phase 4 report.
 *
 * Phase 3 retrofit: every `set()` writes an audit row (category
 * 'core.settings', old/new value) through AuditLogWriter, which also runs
 * both values through @Sensitive redaction — a setting value could itself
 * contain a sensitive-named field someday.
 *
 * Every key this service is ever asked to `get()` is expected to already
 * exist, seeded by the owning migration (see
 * apps/api/src/core/migrations/0003_create_system_settings.sql for the two
 * Auth keys). A missing key is therefore treated as a real bug, not a
 * recoverable "use a default" situation — throwing loudly here is what
 * catches "forgot to seed the migration" during development.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // @Optional: in the real app the @Global AuditModule always provides
    // this. Optional only so lightweight unit fixtures can construct the
    // service without the audit pipeline; a missing writer at runtime is
    // loudly logged below, never silently ignored.
    @Optional() private readonly auditLogWriter?: AuditLogWriter,
  ) {}

  /**
   * key -> cached value. Values are treated as immutable by every consumer
   * (they come straight out of a JSONB column); nothing hands out a copy,
   * so callers must never mutate what `get()` returns.
   */
  private readonly cache = new Map<string, unknown>();

  async get<T>(key: string): Promise<T> {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!row) {
      throw new InternalServerErrorException(
        `system_settings key "${key}" is missing. It should have been seeded by a core migration.`,
      );
    }
    this.cache.set(key, row.value);
    return row.value as T;
  }

  /**
   * All keys starting with `prefix` (e.g. every `notifications.templates.*`
   * row), keyed by FULL key. Deliberately uncached: it exists for the rare
   * admin Settings screen read, and keeping a prefix-scan coherent with the
   * per-key cache isn't worth it — the hot path (`get()`) stays cached.
   */
  async getManyByPrefix(prefix: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: prefix } },
      orderBy: { key: 'asc' },
    });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async set(key: string, value: unknown, updatedBy?: string): Promise<void> {
    const existing = await this.prisma.systemSetting.findUnique({ where: { key } });

    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as never, updatedBy },
      create: { key, value: value as never, updatedBy },
    });

    // Invalidate (rather than overwrite) AFTER the successful write: the
    // next get() re-reads what the DB actually persisted, so the cache can
    // never drift from a value the driver normalized differently.
    this.cache.delete(key);

    if (!this.auditLogWriter) {
      this.logger.error(
        `system_settings write to "${key}" happened with NO AuditLogWriter wired — the write is UNAUDITED. ` +
          'This must never occur outside an isolated unit-test fixture.',
      );
      return;
    }

    // `updatedBy` present means an authenticated person's write reached us
    // (Phase 4's Settings endpoints pass the caller's userId); absent means
    // a genuine no-HTTP-context platform write (seed scripts, future jobs) —
    // which is exactly the "written directly by the calling service, never
    // inferred by the interceptor" case actor_type='system' exists for
    // (ARCHITECTURE.md §8.1 / BUILD_PLAN.md risk #6).
    await this.auditLogWriter.write({
      actorType: updatedBy ? 'user' : 'system',
      actorUserId: updatedBy ?? null,
      actorSessionId: null,
      category: 'core.settings',
      entityType: 'SystemSetting',
      entityId: key,
      action: existing ? 'update' : 'create',
      oldValue: existing ? { value: existing.value } : null,
      newValue: { value },
    });
  }
}
