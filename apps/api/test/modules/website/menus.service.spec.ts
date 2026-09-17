import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MenusService } from '../../../../../modules/website/backend/menus.service';
import type { MenuItemInputDto } from '../../../../../modules/website/backend/dto/replace-menu-items.dto';

interface MockPrisma {
  websiteMenuItem: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    upsert: jest.Mock;
  };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    websiteMenuItem: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: MockPrisma) => unknown) => cb(prisma));
  return prisma;
}

function buildService(prisma: MockPrisma): MenusService {
  const service = new MenusService();
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('MenusService', () => {
  let prisma: MockPrisma;
  let service: MenusService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('list', () => {
    it('scopes to the requested location, ordered by orderIndex', async () => {
      prisma.websiteMenuItem.findMany.mockResolvedValue([]);

      await service.list('header');

      expect(prisma.websiteMenuItem.findMany).toHaveBeenCalledWith({
        where: { location: 'header' },
        orderBy: { orderIndex: 'asc' },
      });
    });
  });

  describe('replace', () => {
    it('upserts every item by id and deletes everything else for that location', async () => {
      const items: MenuItemInputDto[] = [
        { id: 'item-1', label: 'Home', urlOrSlug: '/site', orderIndex: 0 },
        { id: 'item-2', label: 'About', urlOrSlug: 'about', orderIndex: 1, parentId: undefined },
      ];
      prisma.websiteMenuItem.findMany.mockResolvedValue(items);

      await service.replace('header', items);

      expect(prisma.websiteMenuItem.deleteMany).toHaveBeenCalledWith({
        where: { location: 'header', id: { notIn: ['item-1', 'item-2'] } },
      });
      expect(prisma.websiteMenuItem.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.websiteMenuItem.upsert).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        update: { label: 'Home', urlOrSlug: '/site', orderIndex: 0, parentId: undefined },
        create: { id: 'item-1', location: 'header', label: 'Home', urlOrSlug: '/site', orderIndex: 0, parentId: undefined },
      });
    });

    it('deletes every item for the location when the new list is empty (D66: cannot use notIn: [] against a UUID column)', async () => {
      prisma.websiteMenuItem.findMany.mockResolvedValue([]);

      await service.replace('footer', []);

      expect(prisma.websiteMenuItem.deleteMany).toHaveBeenCalledWith({ where: { location: 'footer' } });
      expect(prisma.websiteMenuItem.upsert).not.toHaveBeenCalled();
    });
  });
});
