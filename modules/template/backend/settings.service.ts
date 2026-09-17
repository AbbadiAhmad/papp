import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { UpdateDefaultsDto } from './dto/update-defaults.dto';

export const TEMPLATE_DEFAULTS_KEY = 'template.defaults';
export const DEFAULT_STATUS_FALLBACK = 'active' as const;

/**
 * *** A real, documented gap this file works around — read before copying it ***
 *
 * docs/MODULE_SPEC.md §8.3 describes the core Settings screen growing "one
 * additional section per installed module that declares any `settings`
 * entries, rendered generically" — that generic UI/endpoint does not
 * actually exist anywhere in the codebase (confirmed: `roleAccessLocked` and
 * this generic-settings-surface are both declared in the manifest schema and
 * seeded at install time, but nothing reads them back afterward — see this
 * module's own DECISIONS.md and root docs/DECISIONS.md D70). Until that's
 * built, a module wanting its own admin-editable setting to actually be
 * editable provides its own minimal read/update endpoint, reading/writing
 * the SAME shared `system_settings` table (never a separate per-module
 * settings store, §8.2) directly via its own Prisma client. This is that
 * minimal endpoint — copy it if your module needs the same, delete it if it
 * doesn't (most modules won't need a `settings` entry at all).
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('template (settings) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getDefaults(): Promise<{ defaultStatus: string }> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: TEMPLATE_DEFAULTS_KEY } });
    const value = row?.value as { defaultStatus?: string } | undefined;
    return { defaultStatus: value?.defaultStatus ?? DEFAULT_STATUS_FALLBACK };
  }

  async updateDefaults(dto: UpdateDefaultsDto, updatedBy: string): Promise<{ defaultStatus: string }> {
    await this.prisma.systemSetting.upsert({
      where: { key: TEMPLATE_DEFAULTS_KEY },
      update: { value: { defaultStatus: dto.defaultStatus } as Prisma.InputJsonValue, updatedBy },
      create: { key: TEMPLATE_DEFAULTS_KEY, value: { defaultStatus: dto.defaultStatus } as Prisma.InputJsonValue, updatedBy },
    });
    return { defaultStatus: dto.defaultStatus };
  }
}
