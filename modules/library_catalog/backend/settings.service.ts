import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { UpdateStickerSettingsDto } from './dto/update-sticker-settings.dto';

export const STICKER_SETTINGS_KEY = 'library_catalog.sticker_header_text';
export const STICKER_SETTINGS_FALLBACK: StickerSettings = { headerText: '' };

export interface StickerSettings {
  headerText: string;
}

/**
 * This module's first `system_settings`-backed value (LIBRARY_CATALOG-D22) —
 * same minimal per-module Settings pattern as
 * `modules/library_circulation/backend/settings.service.ts`/
 * `modules/template/backend/settings.service.ts` (root D70/D71: the generic
 * per-module Settings-screen surface doesn't exist yet, so each module ships
 * its own tiny read/update endpoint over the SAME shared `system_settings`
 * table rather than inventing a module-local settings table). The sticker
 * header text (e.g. the school/library name) lives HERE, not in
 * `library_circulation`, because it's book/copy-sticker content and this
 * module already owns the copy data it gets printed alongside — confirmed
 * with the user rather than assumed, since `library_circulation` is where
 * QR rendering/printing was first built (A14) and could have looked like
 * the "natural" home.
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('library_catalog (settings) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getStickerSettings(): Promise<StickerSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: STICKER_SETTINGS_KEY } });
    const value = row?.value as Partial<StickerSettings> | undefined;
    return { headerText: value?.headerText ?? STICKER_SETTINGS_FALLBACK.headerText };
  }

  async updateStickerSettings(dto: UpdateStickerSettingsDto): Promise<StickerSettings> {
    const value: StickerSettings = { headerText: dto.headerText };
    await this.prisma.systemSetting.upsert({
      where: { key: STICKER_SETTINGS_KEY },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { key: STICKER_SETTINGS_KEY, value: value as unknown as Prisma.InputJsonValue },
    });
    return value;
  }
}
