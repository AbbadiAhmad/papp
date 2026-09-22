import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MembershipsService } from '../../backend/memberships.service';
import { StageBookEntriesService } from '../../backend/stage-book-entries.service';

interface MockPrisma {
  readingClubStageBookEntry: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
}

function createMockPrisma(): MockPrisma {
  return {
    readingClubStageBookEntry: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
}

function buildService(prisma: MockPrisma, memberships: Partial<MembershipsService>): StageBookEntriesService {
  const service = new StageBookEntriesService(memberships as MembershipsService);
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('StageBookEntriesService', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('addManual', () => {
    it('creates a manual entry with source=manual and no borrowingId, scoped to the reader\'s current group/stage', async () => {
      const membership = { studentId: 'student-1', episodeId: 'ep-1', groupId: 'g1', currentStageId: 's1' };
      const memberships: Partial<MembershipsService> = {
        getMembershipOrThrow: jest.fn(async () => membership) as unknown as MembershipsService['getMembershipOrThrow'],
      };
      const service = buildService(prisma, memberships);
      prisma.readingClubStageBookEntry.create.mockResolvedValue({ id: 'entry-1', source: 'manual' });

      await service.addManual('student-1', { bookTitle: 'A Book', comments: 'note' }, 'librarian-1');

      expect(prisma.readingClubStageBookEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studentId: 'student-1',
          episodeId: 'ep-1',
          groupId: 'g1',
          stageId: 's1',
          bookTitle: 'A Book',
          comments: 'note',
          source: 'manual',
          borrowingId: undefined,
          addedBy: 'librarian-1',
        }),
      });
    });
  });

  describe('discard vs delete', () => {
    it('discard is a soft update (status=discarded), row stays queryable', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageBookEntry.findUnique.mockResolvedValue({ id: 'entry-1', status: 'active' });
      prisma.readingClubStageBookEntry.update.mockResolvedValue({ id: 'entry-1', status: 'discarded' });

      await service.discard('entry-1', { reason: 'duplicate' }, 'librarian-1');

      expect(prisma.readingClubStageBookEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: expect.objectContaining({ status: 'discarded', discardedBy: 'librarian-1', discardReason: 'duplicate' }),
      });
      expect(prisma.readingClubStageBookEntry.delete).not.toHaveBeenCalled();
    });

    it('discard does NOT require a reason (optional field)', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageBookEntry.findUnique.mockResolvedValue({ id: 'entry-1', status: 'active' });
      prisma.readingClubStageBookEntry.update.mockResolvedValue({ id: 'entry-1', status: 'discarded' });

      await service.discard('entry-1', {}, 'librarian-1');

      expect(prisma.readingClubStageBookEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: expect.objectContaining({ discardReason: null }),
      });
    });

    it('rejects discarding an entry that is already discarded', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageBookEntry.findUnique.mockResolvedValue({ id: 'entry-1', status: 'discarded' });

      await expect(service.discard('entry-1', {}, 'librarian-1')).rejects.toThrow('already discarded');
      expect(prisma.readingClubStageBookEntry.update).not.toHaveBeenCalled();
    });

    it('delete is a hard removal — different from discard, works even on an already-discarded entry', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageBookEntry.findUnique.mockResolvedValue({ id: 'entry-1', status: 'discarded' });
      prisma.readingClubStageBookEntry.delete.mockResolvedValue({ id: 'entry-1' });

      await service.remove('entry-1');

      expect(prisma.readingClubStageBookEntry.delete).toHaveBeenCalledWith({ where: { id: 'entry-1' } });
      expect(prisma.readingClubStageBookEntry.update).not.toHaveBeenCalled();
    });

    it('delete throws NotFoundException for an unknown entry id', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageBookEntry.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow('not found');
      expect(prisma.readingClubStageBookEntry.delete).not.toHaveBeenCalled();
    });
  });

  describe('listForReader', () => {
    it('lists entries scoped to the reader\'s current group/stage window', async () => {
      const membership = { studentId: 'student-1', groupId: 'g1', currentStageId: 's1' };
      const memberships: Partial<MembershipsService> = {
        getMembershipOrThrow: jest.fn(async () => membership) as unknown as MembershipsService['getMembershipOrThrow'],
      };
      const service = buildService(prisma, memberships);
      prisma.readingClubStageBookEntry.findMany.mockResolvedValue([]);

      await service.listForReader('student-1');

      expect(prisma.readingClubStageBookEntry.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1', groupId: 'g1', stageId: 's1' },
        orderBy: { addedAt: 'desc' },
      });
    });
  });
});
