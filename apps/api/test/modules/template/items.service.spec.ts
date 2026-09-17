import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ItemsService } from '../../../../../modules/template/backend/items.service';
import type { CreateItemDto } from '../../../../../modules/template/backend/dto/create-item.dto';
import type { UpdateItemDto } from '../../../../../modules/template/backend/dto/update-item.dto';

interface MockPrisma {
  templateItem: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  systemSetting: {
    findUnique: jest.Mock;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    templateItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    systemSetting: {
      findUnique: jest.fn(),
    },
  };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    title: 'A template item',
    description: null,
    status: 'active',
    ownerUserId: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Same reflection idiom as modules/library_catalog's own
 * books.service.spec.ts (D57 — `ItemsService` owns its own `PrismaClient`
 * field, constructed inertly and never `$connect`ed, then swapped for a
 * jest mock). This file has NO `apps/api/dist/**` imports (unlike
 * `survey`'s `ResponsesService`), so it hits none of root docs/DECISIONS.md
 * D68's ESM/CommonJS Jest wall — a plain, ordinary unit test.
 */
function buildService(prisma: MockPrisma): ItemsService {
  const service = new ItemsService();
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('ItemsService', () => {
  let prisma: MockPrisma;
  let service: ItemsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('create', () => {
    it('uses the caller-supplied status when given', async () => {
      prisma.templateItem.create.mockResolvedValue(itemRow({ status: 'archived' }));
      const dto: CreateItemDto = { title: 'X', status: 'archived' };

      await service.create(dto, 'user-1');

      expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
      expect(prisma.templateItem.create).toHaveBeenCalledWith({
        data: { title: 'X', description: undefined, status: 'archived', ownerUserId: 'user-1' },
      });
    });

    it('falls back to the template.defaults setting when status is omitted', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ key: 'template.defaults', value: { defaultStatus: 'archived' } });
      prisma.templateItem.create.mockResolvedValue(itemRow({ status: 'archived' }));
      const dto: CreateItemDto = { title: 'X' };

      await service.create(dto, 'user-1');

      expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: 'template.defaults' } });
      expect(prisma.templateItem.create).toHaveBeenCalledWith({
        data: { title: 'X', description: undefined, status: 'archived', ownerUserId: 'user-1' },
      });
    });

    it('falls back to "active" when the setting row does not exist at all', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);
      prisma.templateItem.create.mockResolvedValue(itemRow());
      const dto: CreateItemDto = { title: 'X' };

      await service.create(dto, 'user-1');

      expect(prisma.templateItem.create).toHaveBeenCalledWith({
        data: { title: 'X', description: undefined, status: 'active', ownerUserId: 'user-1' },
      });
    });
  });

  describe('update / remove', () => {
    it('throws NotFoundException when the item does not exist', async () => {
      prisma.templateItem.findUnique.mockResolvedValue(null);
      const dto: UpdateItemDto = { title: 'new title' };

      await expect(service.update('missing', dto)).rejects.toThrow('Item not found');
      expect(prisma.templateItem.update).not.toHaveBeenCalled();
    });

    it('updates an existing item', async () => {
      prisma.templateItem.findUnique.mockResolvedValue(itemRow());
      prisma.templateItem.update.mockResolvedValue(itemRow({ title: 'new title' }));

      const result = await service.update('item-1', { title: 'new title' });

      expect(prisma.templateItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { title: 'new title', description: undefined, status: undefined },
      });
      expect(result.title).toBe('new title');
    });
  });

  describe('getPublicIfActive', () => {
    it('returns a minimal safe shape (never ownerUserId) for an active item', async () => {
      prisma.templateItem.findUnique.mockResolvedValue(itemRow({ description: 'hello' }));

      const result = await service.getPublicIfActive('item-1');

      expect(result).toEqual({ id: 'item-1', title: 'A template item', description: 'hello' });
      expect(result).not.toHaveProperty('ownerUserId');
    });

    it('404s for an archived item — never distinguishes "archived" from "does not exist"', async () => {
      prisma.templateItem.findUnique.mockResolvedValue(itemRow({ status: 'archived' }));
      await expect(service.getPublicIfActive('item-1')).rejects.toThrow('Item not found');
    });

    it('404s for a genuinely missing item', async () => {
      prisma.templateItem.findUnique.mockResolvedValue(null);
      await expect(service.getPublicIfActive('missing')).rejects.toThrow('Item not found');
    });
  });
});
