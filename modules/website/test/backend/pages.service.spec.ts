import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { PagesService } from '../../backend/pages.service';
import type { BlockInputDto } from '../../backend/dto/replace-blocks.dto';
import type { CreatePageDto } from '../../backend/dto/create-page.dto';

interface MockPrisma {
  websitePage: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
  websiteBlock: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    upsert: jest.Mock;
  };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    websitePage: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    websiteBlock: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // Every test below runs a single top-level $transaction — hand it the SAME mock prisma as `tx`.
  prisma.$transaction.mockImplementation((cb: (tx: MockPrisma) => unknown) => cb(prisma));
  return prisma;
}

function pageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-1',
    slug: 'about',
    title: 'About',
    status: 'draft',
    isHomepage: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Same D57 reflection idiom every other module's own service spec uses (see template's items.service.spec.ts). */
function buildService(prisma: MockPrisma): PagesService {
  const service = new PagesService();
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('PagesService', () => {
  let prisma: MockPrisma;
  let service: PagesService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('create', () => {
    it('rejects the reserved "admin" slug before ever touching the database', async () => {
      const dto: CreatePageDto = { slug: 'admin', title: 'Admin' };

      await expect(service.create(dto)).rejects.toThrow(/reserved slug/);
      expect(prisma.websitePage.create).not.toHaveBeenCalled();
    });

    it('creates a draft page by default', async () => {
      prisma.websitePage.create.mockResolvedValue(pageRow());
      const dto: CreatePageDto = { slug: 'about', title: 'About' };

      await service.create(dto);

      expect(prisma.websitePage.create).toHaveBeenCalledWith({
        data: { slug: 'about', title: 'About', status: 'draft' },
      });
    });

    it('translates a unique-slug constraint violation into a ConflictException', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['slug'] },
      });
      prisma.websitePage.create.mockRejectedValue(prismaError);

      await expect(service.create({ slug: 'about', title: 'About' })).rejects.toThrow(/already exists/);
    });
  });

  describe('update — homepage exclusivity', () => {
    it('clears any other homepage row in the same transaction when setting a new one', async () => {
      prisma.websitePage.findUnique.mockResolvedValue(pageRow());
      prisma.websitePage.update.mockResolvedValue(pageRow({ isHomepage: true }));

      await service.update('page-1', { isHomepage: true });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.websitePage.updateMany).toHaveBeenCalledWith({
        where: { isHomepage: true, NOT: { id: 'page-1' } },
        data: { isHomepage: false },
      });
      expect(prisma.websitePage.update).toHaveBeenCalledWith({
        where: { id: 'page-1' },
        data: { slug: undefined, title: undefined, isHomepage: true },
      });
    });

    it('does not touch other pages when isHomepage is not being set', async () => {
      prisma.websitePage.findUnique.mockResolvedValue(pageRow());
      prisma.websitePage.update.mockResolvedValue(pageRow({ title: 'New title' }));

      await service.update('page-1', { title: 'New title' });

      expect(prisma.websitePage.updateMany).not.toHaveBeenCalled();
      expect(prisma.websitePage.update).toHaveBeenCalledWith({
        where: { id: 'page-1' },
        data: { slug: undefined, title: 'New title', isHomepage: undefined },
      });
    });

    it('throws NotFoundException for a missing page', async () => {
      prisma.websitePage.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { title: 'X' })).rejects.toThrow('Page not found');
      expect(prisma.websitePage.update).not.toHaveBeenCalled();
    });
  });

  describe('replaceBlocks', () => {
    beforeEach(() => {
      prisma.websitePage.findUnique.mockResolvedValue(pageRow());
    });

    it('upserts every block by id and deletes everything else for that page', async () => {
      const blocks: BlockInputDto[] = [
        { id: 'block-1', orderIndex: 0, type: 'hero', config: { heading: 'Hi' } },
        { id: 'block-2', orderIndex: 1, type: 'text', config: { markdown: 'hello' } },
      ];
      prisma.websiteBlock.findMany.mockResolvedValue(blocks);

      await service.replaceBlocks('page-1', blocks);

      expect(prisma.websiteBlock.deleteMany).toHaveBeenCalledWith({
        where: { pageId: 'page-1', id: { notIn: ['block-1', 'block-2'] } },
      });
      expect(prisma.websiteBlock.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.websiteBlock.upsert).toHaveBeenCalledWith({
        where: { id: 'block-1' },
        update: { orderIndex: 0, type: 'hero', config: { heading: 'Hi' } },
        create: { id: 'block-1', pageId: 'page-1', orderIndex: 0, type: 'hero', config: { heading: 'Hi' } },
      });
    });

    it('deletes every block for the page when the new list is empty (D66: cannot use notIn: [] against a UUID column)', async () => {
      prisma.websiteBlock.findMany.mockResolvedValue([]);

      await service.replaceBlocks('page-1', []);

      expect(prisma.websiteBlock.deleteMany).toHaveBeenCalledWith({ where: { pageId: 'page-1' } });
      expect(prisma.websiteBlock.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing page and never opens a transaction', async () => {
      prisma.websitePage.findUnique.mockResolvedValue(null);

      await expect(service.replaceBlocks('missing', [])).rejects.toThrow('Page not found');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('public reads', () => {
    it('findPublicBySlug 404s for a draft page — never distinguishes "draft" from "does not exist"', async () => {
      prisma.websitePage.findUnique.mockResolvedValue(pageRow({ status: 'draft' }));

      await expect(service.findPublicBySlug('about')).rejects.toThrow('Page not found');
      expect(prisma.websiteBlock.findMany).not.toHaveBeenCalled();
    });

    it('findPublicBySlug 404s for a genuinely missing slug', async () => {
      prisma.websitePage.findUnique.mockResolvedValue(null);

      await expect(service.findPublicBySlug('missing')).rejects.toThrow('Page not found');
    });

    it('findPublicBySlug returns the published page with its ordered blocks', async () => {
      prisma.websitePage.findUnique.mockResolvedValue(pageRow({ status: 'published' }));
      prisma.websiteBlock.findMany.mockResolvedValue([{ id: 'block-1', orderIndex: 0, type: 'hero', config: {} }]);

      const result = await service.findPublicBySlug('about');

      expect(result.blocks).toHaveLength(1);
      expect(prisma.websiteBlock.findMany).toHaveBeenCalledWith({
        where: { pageId: 'page-1' },
        orderBy: { orderIndex: 'asc' },
      });
    });

    it('findPublicHomepage 404s when no page is published as the homepage', async () => {
      prisma.websitePage.findFirst.mockResolvedValue(null);

      await expect(service.findPublicHomepage()).rejects.toThrow('No published homepage is set');
    });
  });
});
