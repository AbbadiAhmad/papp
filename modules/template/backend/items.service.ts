import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { DEFAULT_STATUS_FALLBACK, TEMPLATE_DEFAULTS_KEY } from './settings.service';

/**
 * Own dedicated `PrismaClient` (D57 pattern — see any other module's own
 * service docblock for the full rationale): never core's `PrismaService`
 * directly, a real hoisted `@prisma/client` npm package instead.
 */
@Injectable()
export class ItemsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ItemsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('template Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async list() {
    return this.prisma.templateItem.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findById(id: string) {
    return this.getOrThrow(id);
  }

  async create(dto: CreateItemDto, ownerUserId: string) {
    const status = dto.status ?? (await this.readDefaultStatus());
    return this.prisma.templateItem.create({
      data: { title: dto.title, description: dto.description, status, ownerUserId },
    });
  }

  async update(id: string, dto: UpdateItemDto) {
    await this.getOrThrow(id);
    return this.prisma.templateItem.update({
      where: { id },
      data: { title: dto.title, description: dto.description, status: dto.status },
    });
  }

  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.templateItem.delete({ where: { id } });
  }

  /** Used by the public route — never exposes `ownerUserId`, and only for a currently-`active` item. */
  async getPublicIfActive(id: string) {
    const item = await this.prisma.templateItem.findUnique({ where: { id } });
    if (!item || item.status !== 'active') {
      throw new NotFoundException('Item not found');
    }
    return { id: item.id, title: item.title, description: item.description };
  }

  // --- internals -------------------------------------------------------

  private async getOrThrow(id: string) {
    const item = await this.prisma.templateItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    return item;
  }

  /**
   * Reads the module's own `template.defaults` setting directly off
   * `system_settings` (the SAME table core's cached `SettingsService` reads
   * — modules don't get a separate settings store, just their own
   * namespaced keys, docs/MODULE_SPEC.md §8.2) via this module's own Prisma
   * client (that table's model is part of the one shared schema every
   * module's generated client already includes). No caching layer here on
   * purpose — this is a template, not a proof that every module needs
   * core's exact caching strategy; a real module reading its settings often
   * enough to matter should add its own cache.
   */
  private async readDefaultStatus(): Promise<'active' | 'archived'> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: TEMPLATE_DEFAULTS_KEY } });
    const value = row?.value as { defaultStatus?: string } | undefined;
    return value?.defaultStatus === 'archived' ? 'archived' : DEFAULT_STATUS_FALLBACK;
  }
}
