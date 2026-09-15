import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Minimal `system_settings` read/write service (see docs/BUILD_PLAN.md,
 * Phase 1 note: "plumb early, feature later" — Auth needs
 * `auth.password_policy`/`auth.token_lifetimes` values immediately, so this
 * is deliberately bare: no in-memory caching, no audit-log hookup. Both
 * arrive in Phase 4 (caching + admin Settings screen) and Phase 3 (audit),
 * respectively — do not add either here.
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
  constructor(private readonly prisma: PrismaService) {}

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
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as never, updatedBy },
      create: { key, value: value as never, updatedBy },
    });
  }
}
