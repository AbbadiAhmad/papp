import { Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogWriter } from '../audit/audit-log.writer';

/**
 * Minimal `system_settings` read/write service (see docs/BUILD_PLAN.md,
 * Phase 1 note: "plumb early, feature later" — Auth needs
 * `auth.password_policy`/`auth.token_lifetimes` values immediately, so this
 * is deliberately bare: no in-memory caching (that arrives in Phase 4 with
 * the admin Settings screen).
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

  async get<T>(key: string): Promise<T> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!row) {
      throw new InternalServerErrorException(
        `system_settings key "${key}" is missing. It should have been seeded by a core migration.`,
      );
    }
    return row.value as T;
  }

  async set(key: string, value: unknown, updatedBy?: string): Promise<void> {
    const existing = await this.prisma.systemSetting.findUnique({ where: { key } });

    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as never, updatedBy },
      create: { key, value: value as never, updatedBy },
    });

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
