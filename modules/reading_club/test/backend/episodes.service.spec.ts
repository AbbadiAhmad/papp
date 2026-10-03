import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EpisodesService } from '../../backend/episodes.service';

interface MockPrisma {
  readingClubEpisode: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock; create: jest.Mock; delete: jest.Mock };
  readingClubGroup: { findMany: jest.Mock; deleteMany: jest.Mock };
  readingClubStage: { deleteMany: jest.Mock };
  readingClubMembership: { count: jest.Mock; deleteMany: jest.Mock };
  readingClubStageCompletion: { count: jest.Mock; deleteMany: jest.Mock };
  readingClubStageBookEntry: { count: jest.Mock; deleteMany: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  return {
    readingClubEpisode: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
    readingClubGroup: { findMany: jest.fn(() => Promise.resolve([])), deleteMany: jest.fn() },
    readingClubStage: { deleteMany: jest.fn() },
    readingClubMembership: { count: jest.fn(() => Promise.resolve(0)), deleteMany: jest.fn() },
    readingClubStageCompletion: { count: jest.fn(() => Promise.resolve(0)), deleteMany: jest.fn() },
    readingClubStageBookEntry: { count: jest.fn(() => Promise.resolve(0)), deleteMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

function buildService(prisma: MockPrisma): EpisodesService {
  const service = new EpisodesService();
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('EpisodesService', () => {
  let prisma: MockPrisma;
  let service: EpisodesService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('createEpisode', () => {
    it('closes the previously-current episode and creates the new one as current, in one transaction, when one was already current', async () => {
      prisma.readingClubEpisode.findFirst.mockResolvedValue({ id: 'ep-old', name: 'Old Season', isCurrent: true });
      prisma.readingClubEpisode.update.mockResolvedValue({ id: 'ep-old', isCurrent: false });
      prisma.readingClubEpisode.create.mockResolvedValue({ id: 'ep-new', name: 'New Season', isCurrent: true });

      const result = await service.createEpisode({ name: 'New Season' }, 'librarian-1');

      expect(prisma.readingClubEpisode.update).toHaveBeenCalledWith({
        where: { id: 'ep-old' },
        data: expect.objectContaining({ isCurrent: false }),
      });
      expect(prisma.readingClubEpisode.create).toHaveBeenCalledWith({
        data: { name: 'New Season', isCurrent: true, createdBy: 'librarian-1' },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 'ep-new', name: 'New Season', isCurrent: true });
    });

    it('creates the first episode directly (no close step) when none was current yet', async () => {
      prisma.readingClubEpisode.findFirst.mockResolvedValue(null);
      prisma.readingClubEpisode.create.mockResolvedValue({ id: 'ep-1', name: 'Season 1', isCurrent: true });

      await service.createEpisode({ name: 'Season 1' }, 'librarian-1');

      expect(prisma.readingClubEpisode.update).not.toHaveBeenCalled();
      expect(prisma.readingClubEpisode.create).toHaveBeenCalledWith({
        data: { name: 'Season 1', isCurrent: true, createdBy: 'librarian-1' },
      });
    });
  });

  describe('assertEpisodeIsCurrent', () => {
    it('rejects a write against a closed (non-current) episode', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue({ id: 'ep-old', isCurrent: false });
      await expect(service.assertEpisodeIsCurrent('ep-old')).rejects.toThrow('closed');
    });

    it('allows a write against the current episode', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue({ id: 'ep-new', isCurrent: true });
      await expect(service.assertEpisodeIsCurrent('ep-new')).resolves.toBeUndefined();
    });

    it('throws NotFoundException for an unknown episode id', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue(null);
      await expect(service.assertEpisodeIsCurrent('missing')).rejects.toThrow('Episode not found');
    });
  });

  describe('getCurrentEpisode', () => {
    it('throws NotFoundException when no episode is current', async () => {
      prisma.readingClubEpisode.findFirst.mockResolvedValue(null);
      await expect(service.getCurrentEpisode()).rejects.toThrow('No current episode');
    });

    it('returns the current episode when one exists', async () => {
      prisma.readingClubEpisode.findFirst.mockResolvedValue({ id: 'ep-1', isCurrent: true });
      await expect(service.getCurrentEpisode()).resolves.toEqual({ id: 'ep-1', isCurrent: true });
    });
  });

  describe('findCurrentEpisodeOrNull', () => {
    it('returns null (never throws) when no episode is current', async () => {
      prisma.readingClubEpisode.findFirst.mockResolvedValue(null);
      await expect(service.findCurrentEpisodeOrNull()).resolves.toBeNull();
    });
  });

  describe('getDeletePreview (READING_CLUB-D17)', () => {
    it('returns real counts of everything a delete would cascade away', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue({ id: 'ep-1', name: 'Season 1', isCurrent: false });
      prisma.readingClubGroup.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
      prisma.readingClubMembership.count.mockResolvedValue(5);
      prisma.readingClubStageCompletion.count.mockResolvedValue(12);
      prisma.readingClubStageBookEntry.count.mockResolvedValue(30);

      const preview = await service.getDeletePreview('ep-1');

      expect(preview).toEqual({
        episodeId: 'ep-1',
        isCurrent: false,
        groupCount: 2,
        readerCount: 5,
        completionCount: 12,
        bookEntryCount: 30,
      });
    });

    it('throws NotFoundException for an unknown episode id', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue(null);
      await expect(service.getDeletePreview('missing')).rejects.toThrow('Episode not found');
    });
  });

  describe('deleteEpisode (READING_CLUB-D17 — full cascade, no history preservation)', () => {
    it('deletes the current episode: cascades book entries, completions, memberships, stages, groups, then the episode itself, in that order', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue({ id: 'ep-current', name: 'Season 2026', isCurrent: true });
      prisma.readingClubGroup.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
      prisma.readingClubMembership.count.mockResolvedValue(7);
      prisma.readingClubStageCompletion.count.mockResolvedValue(3);
      prisma.readingClubStageBookEntry.count.mockResolvedValue(9);

      const result = await service.deleteEpisode('ep-current');

      expect(prisma.readingClubStageBookEntry.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 'ep-current' } });
      expect(prisma.readingClubStageCompletion.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 'ep-current' } });
      expect(prisma.readingClubMembership.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 'ep-current' } });
      expect(prisma.readingClubStage.deleteMany).toHaveBeenCalledWith({ where: { groupId: { in: ['g1', 'g2'] } } });
      expect(prisma.readingClubGroup.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 'ep-current' } });
      expect(prisma.readingClubEpisode.delete).toHaveBeenCalledWith({ where: { id: 'ep-current' } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        affectedGroupCount: 2,
        affectedReaderCount: 7,
        affectedCompletionCount: 3,
        affectedBookEntryCount: 9,
        wasCurrent: true,
      });

      // Deleting the current episode leaves NONE current — no auto-promotion
      // of another episode (READING_CLUB-D17); the transaction never touches
      // any OTHER episode row.
      expect(prisma.readingClubEpisode.update).not.toHaveBeenCalled();
    });

    it('deletes a non-current (closed) episode the same way — any episode is deletable', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue({ id: 'ep-old', name: 'Season 2025', isCurrent: false });
      prisma.readingClubGroup.findMany.mockResolvedValue([{ id: 'g1' }]);
      prisma.readingClubMembership.count.mockResolvedValue(1);
      prisma.readingClubStageCompletion.count.mockResolvedValue(4);
      prisma.readingClubStageBookEntry.count.mockResolvedValue(2);

      const result = await service.deleteEpisode('ep-old');

      expect(prisma.readingClubEpisode.delete).toHaveBeenCalledWith({ where: { id: 'ep-old' } });
      expect(result.wasCurrent).toBe(false);
    });

    it('skips the stage deleteMany call entirely when the episode has no groups at all', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue({ id: 'ep-empty', name: 'Empty Season', isCurrent: false });
      prisma.readingClubGroup.findMany.mockResolvedValue([]);
      prisma.readingClubMembership.count.mockResolvedValue(0);
      prisma.readingClubStageCompletion.count.mockResolvedValue(0);
      prisma.readingClubStageBookEntry.count.mockResolvedValue(0);

      const result = await service.deleteEpisode('ep-empty');

      expect(prisma.readingClubStage.deleteMany).not.toHaveBeenCalled();
      expect(prisma.readingClubEpisode.delete).toHaveBeenCalledWith({ where: { id: 'ep-empty' } });
      expect(result).toEqual({
        affectedGroupCount: 0,
        affectedReaderCount: 0,
        affectedCompletionCount: 0,
        affectedBookEntryCount: 0,
        wasCurrent: false,
      });
    });

    it('throws NotFoundException for an unknown episode id and never starts the delete transaction', async () => {
      prisma.readingClubEpisode.findUnique.mockResolvedValue(null);
      await expect(service.deleteEpisode('missing')).rejects.toThrow('Episode not found');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
