import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EpisodesService } from '../../backend/episodes.service';
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

/** Same reflection idiom every module's own service spec uses (D57). `episodes` defaults to "always current" — tests exercising episode-scoping override it explicitly. */
function buildService(prisma: MockPrisma, episodes: Partial<EpisodesService> = defaultEpisodesMock()): GroupsService {
  const service = new GroupsService(episodes as EpisodesService);
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

function defaultEpisodesMock(): Partial<EpisodesService> {
  return {
    getCurrentEpisode: jest.fn(async () => ({ id: 'ep-current', name: 'Current', isCurrent: true })) as unknown as EpisodesService['getCurrentEpisode'],
    // `listGroups`/`getDashboardStats` (no explicit `episodeId`) resolve the
    // current episode via this null-safe lookup, not `getCurrentEpisode`
    // (READING_CLUB-D17) — defaults to "one exists" here; the "no current
    // episode at all" case is exercised by its own dedicated tests below.
    findCurrentEpisodeOrNull: jest.fn(async () => ({ id: 'ep-current', name: 'Current', isCurrent: true })) as unknown as EpisodesService['findCurrentEpisodeOrNull'],
    assertEpisodeIsCurrent: jest.fn(async () => undefined) as unknown as EpisodesService['assertEpisodeIsCurrent'],
  };
}

describe('GroupsService', () => {
  let prisma: MockPrisma;
  let service: GroupsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('removeGroup', () => {
    // READING_CLUB-D16: deletion is now ALWAYS allowed, regardless of
    // history — the history-blocking checks that used to live here were
    // removed on deliberate user request, not a bug fix. These tests now
    // assert the opposite of what they used to: readers assigned / history
    // present no longer blocks anything.
    it('succeeds even when the group has readers assigned, and reports the affected count', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-current' });
      prisma.readingClubMembership.count.mockResolvedValue(3);
      prisma.readingClubStage.deleteMany.mockResolvedValue({ count: 2 });
      prisma.readingClubGroup.delete.mockResolvedValue({ id: 'g1' });

      const result = await service.removeGroup('g1');

      expect(result).toEqual({ affectedActiveReaderCount: 3 });
      expect(prisma.readingClubGroup.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
    });

    it('deletes stages then the group when it has no active readers', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-current' });
      prisma.readingClubMembership.count.mockResolvedValue(0);
      prisma.readingClubStage.deleteMany.mockResolvedValue({ count: 2 });
      prisma.readingClubGroup.delete.mockResolvedValue({ id: 'g1' });

      const result = await service.removeGroup('g1');

      expect(result).toEqual({ affectedActiveReaderCount: 0 });
      expect(prisma.readingClubStage.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'g1' } });
      expect(prisma.readingClubGroup.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
    });

    it('rejects deleting a group in a closed (non-current) episode — the episode-current check is the only remaining block', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-old' });
      const episodes: Partial<EpisodesService> = {
        assertEpisodeIsCurrent: jest.fn(async () => {
          throw new Error('This episode is closed — only the current episode can be modified');
        }) as unknown as EpisodesService['assertEpisodeIsCurrent'],
      };
      const closedEpisodeService = buildService(prisma, episodes);

      await expect(closedEpisodeService.removeGroup('g1')).rejects.toThrow('closed');
      expect(prisma.readingClubGroup.delete).not.toHaveBeenCalled();
    });
  });

  describe('removeStage', () => {
    it('succeeds even when a reader is currently on the stage, and reports the affected count', async () => {
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's1', groupId: 'g1' });
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-current' });
      prisma.readingClubMembership.count.mockResolvedValue(1);
      prisma.readingClubStage.delete.mockResolvedValue({ id: 's1' });

      const result = await service.removeStage('s1');

      expect(result).toEqual({ affectedActiveReaderCount: 1 });
      expect(prisma.readingClubStage.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('deletes a stage with no readers currently on it', async () => {
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's1', groupId: 'g1' });
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-current' });
      prisma.readingClubMembership.count.mockResolvedValue(0);
      prisma.readingClubStage.delete.mockResolvedValue({ id: 's1' });

      const result = await service.removeStage('s1');

      expect(result).toEqual({ affectedActiveReaderCount: 0 });
      expect(prisma.readingClubStage.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('rejects removing a stage in a closed (non-current) episode', async () => {
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's1', groupId: 'g1' });
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-old' });
      const episodes: Partial<EpisodesService> = {
        assertEpisodeIsCurrent: jest.fn(async () => {
          throw new Error('This episode is closed — only the current episode can be modified');
        }) as unknown as EpisodesService['assertEpisodeIsCurrent'],
      };
      const closedEpisodeService = buildService(prisma, episodes);

      await expect(closedEpisodeService.removeStage('s1')).rejects.toThrow('closed');
      expect(prisma.readingClubStage.delete).not.toHaveBeenCalled();
    });
  });

  describe('listGroups — no current episode (READING_CLUB-D17)', () => {
    it('returns an empty list, not a thrown error, when episodeId is omitted and no episode is current', async () => {
      const episodes: Partial<EpisodesService> = {
        findCurrentEpisodeOrNull: jest.fn(async () => null) as unknown as EpisodesService['findCurrentEpisodeOrNull'],
      };
      const noCurrentEpisodeService = buildService(prisma, episodes);

      await expect(noCurrentEpisodeService.listGroups()).resolves.toEqual([]);
      expect(prisma.readingClubGroup.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getDashboardStats — no current episode (READING_CLUB-D17)', () => {
    it('returns an all-zero/empty stats object, not a thrown error, when episodeId is omitted and no episode is current', async () => {
      const episodes: Partial<EpisodesService> = {
        findCurrentEpisodeOrNull: jest.fn(async () => null) as unknown as EpisodesService['findCurrentEpisodeOrNull'],
      };
      const noCurrentEpisodeService = buildService(prisma, episodes);

      const stats = await noCurrentEpisodeService.getDashboardStats();

      expect(stats).toEqual({ totalGroups: 0, totalActiveReaders: 0, groups: [] });
      expect(prisma.readingClubGroup.findMany).not.toHaveBeenCalled();
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
