import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EpisodesService } from '../../backend/episodes.service';

interface MockPrisma {
  readingClubEpisode: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  return {
    readingClubEpisode: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
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
});
