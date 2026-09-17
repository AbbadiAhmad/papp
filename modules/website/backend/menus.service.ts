import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MenuItemInputDto } from './dto/replace-menu-items.dto';

const LOCATIONS = ['header', 'footer'] as const;
type Location = (typeof LOCATIONS)[number];

/** Header/footer navigation menus for the public site. Own dedicated `PrismaClient` (D57 pattern). */
@Injectable()
export class MenusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MenusService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('website (menus) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async list(location: Location) {
    return this.prisma.websiteMenuItem.findMany({ where: { location }, orderBy: { orderIndex: 'asc' } });
  }

  async listPublic(location: Location) {
    return this.list(location);
  }

  /** Whole-list replace-by-id for one location — same pattern as `PagesService.replaceBlocks`. */
  async replace(location: Location, items: MenuItemInputDto[]) {
    return this.prisma.$transaction(async (tx) => {
      const keepIds = items.map((i) => i.id);
      if (keepIds.length > 0) {
        await tx.websiteMenuItem.deleteMany({ where: { location, id: { notIn: keepIds } } });
      } else {
        await tx.websiteMenuItem.deleteMany({ where: { location } });
      }
      for (const item of items) {
        await tx.websiteMenuItem.upsert({
          where: { id: item.id },
          update: { label: item.label, urlOrSlug: item.urlOrSlug, orderIndex: item.orderIndex, parentId: item.parentId },
          create: {
            id: item.id,
            location,
            label: item.label,
            urlOrSlug: item.urlOrSlug,
            orderIndex: item.orderIndex,
            parentId: item.parentId,
          },
        });
      }
      return tx.websiteMenuItem.findMany({ where: { location }, orderBy: { orderIndex: 'asc' } });
    });
  }
}
