import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreatePageDto, RESERVED_SLUGS } from './dto/create-page.dto';
import { BlockInputDto } from './dto/replace-blocks.dto';
import { UpdatePageDto } from './dto/update-page.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Pages + their ordered blocks. Own dedicated `PrismaClient` (D57 pattern,
 * same as every other module).
 */
@Injectable()
export class PagesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PagesService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('website (pages) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async list() {
    return this.prisma.websitePage.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findById(id: string) {
    const page = await this.getOrThrow(id);
    const blocks = await this.prisma.websiteBlock.findMany({ where: { pageId: id }, orderBy: { orderIndex: 'asc' } });
    return { ...page, blocks };
  }

  async create(dto: CreatePageDto) {
    this.assertSlugNotReserved(dto.slug);
    try {
      return await this.prisma.websitePage.create({
        data: { slug: dto.slug, title: dto.title, status: dto.status ?? 'draft' },
      });
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  async update(id: string, dto: UpdatePageDto) {
    await this.getOrThrow(id);
    if (dto.slug !== undefined) this.assertSlugNotReserved(dto.slug);

    try {
      if (dto.isHomepage === true) {
        // At most one homepage (partial unique index) — clear the previous one first, in the same transaction.
        return await this.prisma.$transaction(async (tx) => {
          await tx.websitePage.updateMany({ where: { isHomepage: true, NOT: { id } }, data: { isHomepage: false } });
          return tx.websitePage.update({
            where: { id },
            data: { slug: dto.slug, title: dto.title, isHomepage: true },
          });
        });
      }
      return await this.prisma.websitePage.update({
        where: { id },
        data: { slug: dto.slug, title: dto.title, isHomepage: dto.isHomepage },
      });
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.websitePage.delete({ where: { id } }); // cascades to blocks
  }

  async publish(id: string) {
    await this.getOrThrow(id);
    return this.prisma.websitePage.update({ where: { id }, data: { status: 'published' } });
  }

  async unpublish(id: string) {
    await this.getOrThrow(id);
    return this.prisma.websitePage.update({ where: { id }, data: { status: 'draft' } });
  }

  /** Whole-block-list replace-by-id (upsert-by-id so unmodified blocks keep their id; an omitted block is deleted) — same pattern as survey's structure endpoint. */
  async replaceBlocks(pageId: string, blocks: BlockInputDto[]) {
    await this.getOrThrow(pageId);

    return this.prisma.$transaction(async (tx) => {
      const keepIds = blocks.map((b) => b.id);
      // D66's own lesson: an empty keep-list can't use `notIn: []` against a UUID column — use a conditional where instead.
      if (keepIds.length > 0) {
        await tx.websiteBlock.deleteMany({ where: { pageId, id: { notIn: keepIds } } });
      } else {
        await tx.websiteBlock.deleteMany({ where: { pageId } });
      }
      for (const block of blocks) {
        await tx.websiteBlock.upsert({
          where: { id: block.id },
          update: { orderIndex: block.orderIndex, type: block.type, config: block.config as Prisma.InputJsonValue },
          create: {
            id: block.id,
            pageId,
            orderIndex: block.orderIndex,
            type: block.type,
            config: block.config as Prisma.InputJsonValue,
          },
        });
      }
      return tx.websiteBlock.findMany({ where: { pageId }, orderBy: { orderIndex: 'asc' } });
    });
  }

  async findPublicBySlug(slug: string) {
    const page = await this.prisma.websitePage.findUnique({ where: { slug } });
    if (!page || page.status !== 'published') {
      throw new NotFoundException('Page not found');
    }
    const blocks = await this.prisma.websiteBlock.findMany({ where: { pageId: page.id }, orderBy: { orderIndex: 'asc' } });
    return { ...page, blocks };
  }

  async findPublicHomepage() {
    const page = await this.prisma.websitePage.findFirst({ where: { isHomepage: true, status: 'published' } });
    if (!page) {
      throw new NotFoundException('No published homepage is set');
    }
    const blocks = await this.prisma.websiteBlock.findMany({ where: { pageId: page.id }, orderBy: { orderIndex: 'asc' } });
    return { ...page, blocks };
  }

  // --- internals ---------------------------------------------------------

  private assertSlugNotReserved(slug: string): void {
    if (RESERVED_SLUGS.includes(slug)) {
      throw new ConflictException(`"${slug}" is a reserved slug (shadowed by the admin routes) — choose another.`);
    }
  }

  private async getOrThrow(id: string) {
    const page = await this.prisma.websitePage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  private translateUniqueConstraintError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return new ConflictException(`A page with this ${target} already exists`);
    }
    return error;
  }
}
