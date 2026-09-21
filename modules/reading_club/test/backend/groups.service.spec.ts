import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GroupsService } from '../../backend/groups.service';

interface MockPrisma {
  readingClubGroup: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  readingClubStage: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock; deleteMany: jest.Mock; findFirst: jest.Mock };
  readingClubMembership: { count: jest.Mock; findMany: jest.Mock };
  readingClubStageCompletion: { count: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  return {
    readingClubGroup: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    readingClubStage: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
    },
    readingClubMembership: { count: jest.fn(), findMany: jest.fn() },
    readingClubStageCompletion: { count: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

/** Same reflection idiom every module's own service spec uses (D57). */
function buildService(prisma: MockPrisma): GroupsService {
  const service = new GroupsService();
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('GroupsService', () => {
  let prisma: MockPrisma;
  let service: GroupsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('removeGroup', () => {
    it('rejects when the group has readers assigned', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1' });
      prisma.readingClubMembership.count.mockResolvedValue(1);
      prisma.readingClubStageCompletion.count.mockResolvedValue(0);

      await expect(service.removeGroup('g1')).rejects.toThrow('readers assigned');
      expect(prisma.readingClubGroup.delete).not.toHaveBeenCalled();
    });

    it('rejects when the group has completion history', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1' });
      prisma.readingClubMembership.count.mockResolvedValue(0);
      prisma.readingClubStageCompletion.count.mockResolvedValue(1);

      await expect(service.removeGroup('g1')).rejects.toThrow('completion history');
    });

    it('deletes stages then the group when it is clean', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1' });
      prisma.readingClubMembership.count.mockResolvedValue(0);
      prisma.readingClubStageCompletion.count.mockResolvedValue(0);
      prisma.readingClubStage.deleteMany.mockResolvedValue({ count: 2 });
      prisma.readingClubGroup.delete.mockResolvedValue({ id: 'g1' });

      await service.removeGroup('g1');

      expect(prisma.readingClubStage.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'g1' } });
      expect(prisma.readingClubGroup.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
    });
  });

  describe('removeStage', () => {
    it('rejects when a reader is currently on the stage', async () => {
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's1' });
      prisma.readingClubMembership.count.mockResolvedValue(1);
      prisma.readingClubStageCompletion.count.mockResolvedValue(0);

      await expect(service.removeStage('s1')).rejects.toThrow('currently on it');
      expect(prisma.readingClubStage.delete).not.toHaveBeenCalled();
    });

    it('deletes a stage with no readers and no history', async () => {
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's1' });
      prisma.readingClubMembership.count.mockResolvedValue(0);
      prisma.readingClubStageCompletion.count.mockResolvedValue(0);

      await service.removeStage('s1');

      expect(prisma.readingClubStage.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });
  });

  describe('getDashboardStats', () => {
    it('aggregates member counts and per-stage reader counts from real rows, never mock data', async () => {
      prisma.readingClubGroup.findMany.mockResolvedValue([
        {
          id: 'g1',
          name: 'Grade 3',
          isActive: true,
          stages: [
            { id: 's1', name: 'Stage 1', stageOrder: 1, targetType: 'books', targetAmount: 5 },
            { id: 's2', name: 'Stage 2', stageOrder: 2, targetType: 'books', targetAmount: 10 },
          ],
        },
      ]);
      prisma.readingClubMembership.findMany.mockResolvedValue([
        { id: 'm1', groupId: 'g1', currentStageId: 's1' },
        { id: 'm2', groupId: 'g1', currentStageId: 's1' },
        { id: 'm3', groupId: 'g1', currentStageId: 's2' },
      ]);

      const stats = await service.getDashboardStats();

      expect(stats.totalGroups).toBe(1);
      expect(stats.totalActiveReaders).toBe(3);
      expect(stats.groups[0].memberCount).toBe(3);
      expect(stats.groups[0].stages[0].readersOnStageCount).toBe(2);
      expect(stats.groups[0].stages[1].readersOnStageCount).toBe(1);
    });
  });

  describe('createStage', () => {
    it('throws NotFoundException when the group does not exist', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue(null);
      await expect(
        service.createStage('missing', { stageOrder: 1, name: 'Stage 1', targetType: 'books', targetAmount: 5 }),
      ).rejects.toThrow('Group not found');
    });

    it('propagates a non-Prisma error from create unchanged (translateUniqueConstraintError only rewrites real P2002 errors)', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1' });
      prisma.readingClubStage.create.mockRejectedValue(new Error('boom'));

      await expect(
        service.createStage('g1', { stageOrder: 1, name: 'Stage 1', targetType: 'books', targetAmount: 5 }),
      ).rejects.toThrow('boom');
    });
  });
});
