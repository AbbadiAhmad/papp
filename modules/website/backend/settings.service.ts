import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { UpdateSiteConfigDto } from './dto/update-site-config.dto';

export const SITE_CONFIG_KEY = 'website.site_config';
export const SITE_CONFIG_FALLBACK: SiteConfig = { siteTitle: 'papp', logoUrl: null };

export interface SiteConfig {
  siteTitle: string;
  logoUrl: string | null;
}

/**
 * Same documented gap/pattern as every other module's own minimal settings
 * endpoint (root D70/D71 — the generic per-module Settings-screen surface
 * doesn't exist yet): reads/writes the SAME shared `system_settings` table
 * directly via this module's own Prisma client.
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('website (settings) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getSiteConfig(): Promise<SiteConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SITE_CONFIG_KEY } });
    const value = row?.value as Partial<SiteConfig> | undefined;
    return {
      siteTitle: value?.siteTitle ?? SITE_CONFIG_FALLBACK.siteTitle,
      logoUrl: value?.logoUrl ?? SITE_CONFIG_FALLBACK.logoUrl,
    };
  }

  async updateSiteConfig(dto: UpdateSiteConfigDto): Promise<SiteConfig> {
    const value: SiteConfig = { siteTitle: dto.siteTitle, logoUrl: dto.logoUrl ?? null };
    await this.prisma.systemSetting.upsert({
      where: { key: SITE_CONFIG_KEY },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { key: SITE_CONFIG_KEY, value: value as unknown as Prisma.InputJsonValue },
    });
    return value;
  }
}
