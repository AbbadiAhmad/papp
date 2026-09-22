import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EpisodesService } from '../../backend/episodes.service';
import { MembershipsService } from '../../backend/memberships.service';

interface MockPrisma {
  readingClubGroup: { findUnique: jest.Mock };
  readingClubStage: { findUnique: jest.Mock; findFirst: jest.Mock };
  readingClubMembership: { findUnique: jest.Mock; findMany: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  readingClubStageCompletion: { findMany: jest.Mock };
  readingClubStageBookEntry: { findMany: jest.Mock; create: jest.Mock };
  libraryStudent: { findUnique: jest.Mock; findMany: jest.Mock };
  user: { findUnique: jest.Mock; findMany: jest.Mock };
  libraryBorrowing: { count: jest.Mock; findMany: jest.Mock };
  libraryCatalogBookCopy: { findUnique: jest.Mock };
  libraryCatalogBook: { findUnique: jest.Mock };
}

function createMockPrisma(): MockPrisma {
  return {
    readingClubGroup: { findUnique: jest.fn() },
    readingClubStage: { findUnique: jest.fn(), findFirst: jest.fn() },
    readingClubMembership: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    readingClubStageCompletion: { findMany: jest.fn(() => Promise.resolve([])) },
    readingClubStageBookEntry: { findMany: jest.fn(() => Promise.resolve([])), create: jest.fn() },
    libraryStudent: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    libraryBorrowing: { count: jest.fn(), findMany: jest.fn(() => Promise.resolve([])) },
    libraryCatalogBookCopy: { findUnique: jest.fn() },
    libraryCatalogBook: { findUnique: jest.fn() },
  };
}

function defaultEpisodesMock(): Partial<EpisodesService> {
  return {
    getCurrentEpisode: jest.fn(async () => ({ id: 'ep-current', name: 'Current', isCurrent: true })) as unknown as EpisodesService['getCurrentEpisode'],
    assertEpisodeIsCurrent: jest.fn(async () => undefined) as unknown as EpisodesService['assertEpisodeIsCurrent'],
  };
}

function buildService(prisma: MockPrisma, episodes: Partial<EpisodesService> = defaultEpisodesMock()): MembershipsService {
  const service = new MembershipsService(episodes as EpisodesService);
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('MembershipsService', () => {
  let prisma: MockPrisma;
  let service: MembershipsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('computeStageProgress', () => {
    it('counts books returned since stageStartedAt for a "books" stage — never manualProgressAmount', async () => {
      prisma.libraryBorrowing.count.mockResolvedValue(3);
      const stageStartedAt = new Date('2026-01-01T00:00:00Z');

      const progress = await service.computeStageProgress('student-1', stageStartedAt, 99, { targetType: 'books', targetAmount: 5 });

      expect(prisma.libraryBorrowing.count).toHaveBeenCalledWith({
        where: { studentId: 'student-1', status: 'returned', returnedAt: { gte: stageStartedAt } },
      });
      expect(progress).toEqual({ targetType: 'books', targetAmount: 5, progressAmount: 3, isComplete: false });
    });

    it('uses manualProgressAmount for a "pages" stage — never queries borrowings', async () => {
      const progress = await service.computeStageProgress('student-1', new Date(), 420, { targetType: 'pages', targetAmount: 500 });

      expect(prisma.libraryBorrowing.count).not.toHaveBeenCalled();
      expect(progress).toEqual({ targetType: 'pages', targetAmount: 500, progressAmount: 420, isComplete: false });
    });

    it('marks isComplete true once progress reaches the target', async () => {
      prisma.libraryBorrowing.count.mockResolvedValue(5);
      const progress = await service.computeStageProgress('student-1', new Date(), 0, { targetType: 'books', targetAmount: 5 });
      expect(progress.isComplete).toBe(true);
    });
  });

  describe('assign', () => {
    it('defaults to the group\'s first stage when no stageId is given, and stamps the group\'s own episodeId', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-current' });
      prisma.readingClubStage.findFirst.mockResolvedValue({ id: 'stage-1', groupId: 'g1', stageOrder: 1 });
      prisma.readingClubMembership.upsert.mockResolvedValue({ studentId: 'student-1', groupId: 'g1', currentStageId: 'stage-1' });

      await service.assign({ studentId: 'student-1', groupId: 'g1' }, 'librarian-1');

      expect(prisma.readingClubStage.findFirst).toHaveBeenCalledWith({ where: { groupId: 'g1' }, orderBy: { stageOrder: 'asc' } });
      expect(prisma.readingClubMembership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { studentId: 'student-1' },
          create: expect.objectContaining({ episodeId: 'ep-current', groupId: 'g1', currentStageId: 'stage-1', manualProgressAmount: 0, assignedBy: 'librarian-1' }),
        }),
      );
    });

    it('rejects when the given stage does not belong to the target group', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-current' });
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 'stage-x', groupId: 'OTHER_GROUP' });

      await expect(service.assign({ studentId: 'student-1', groupId: 'g1', stageId: 'stage-x' }, 'librarian-1')).rejects.toThrow(
        'does not belong to the target group',
      );
      expect(prisma.readingClubMembership.upsert).not.toHaveBeenCalled();
    });

    it('rejects when the target group does not exist', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue(null);
      await expect(service.assign({ studentId: 'student-1', groupId: 'missing' }, 'librarian-1')).rejects.toThrow('Group not found');
    });

    it('rejects assigning a reader to a group whose episode is closed (non-current)', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', episodeId: 'ep-old' });
      const closedEpisodes: Partial<EpisodesService> = {
        assertEpisodeIsCurrent: jest.fn(async () => {
          throw new Error('This episode is closed — only the current episode can be modified');
        }) as unknown as EpisodesService['assertEpisodeIsCurrent'],
      };
      const closedEpisodeService = buildService(prisma, closedEpisodes);

      await expect(closedEpisodeService.assign({ studentId: 'student-1', groupId: 'g1' }, 'librarian-1')).rejects.toThrow('closed');
      expect(prisma.readingClubMembership.upsert).not.toHaveBeenCalled();
    });
  });

  describe('moveStage', () => {
    it('rejects moving to a stage in a different group', async () => {
      prisma.readingClubMembership.findUnique.mockResolvedValue({ studentId: 'student-1', groupId: 'g1', currentStageId: 's1' });
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's2', groupId: 'OTHER_GROUP' });

      await expect(service.moveStage('student-1', { stageId: 's2' })).rejects.toThrow('current group');
      expect(prisma.readingClubMembership.update).not.toHaveBeenCalled();
    });

    it('moves within the same group and resets progress anchors', async () => {
      prisma.readingClubMembership.findUnique.mockResolvedValue({ studentId: 'student-1', episodeId: 'ep-current', groupId: 'g1', currentStageId: 's1' });
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's2', groupId: 'g1' });
      prisma.readingClubMembership.update.mockResolvedValue({ studentId: 'student-1', currentStageId: 's2' });

      await service.moveStage('student-1', { stageId: 's2' });

      expect(prisma.readingClubMembership.update).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        data: expect.objectContaining({ currentStageId: 's2', manualProgressAmount: 0 }),
      });
    });

    it('rejects moving stage when the membership\'s episode is closed', async () => {
      prisma.readingClubMembership.findUnique.mockResolvedValue({ studentId: 'student-1', episodeId: 'ep-old', groupId: 'g1', currentStageId: 's1' });
      const closedEpisodes: Partial<EpisodesService> = {
        assertEpisodeIsCurrent: jest.fn(async () => {
          throw new Error('This episode is closed — only the current episode can be modified');
        }) as unknown as EpisodesService['assertEpisodeIsCurrent'],
      };
      const closedEpisodeService = buildService(prisma, closedEpisodes);

      await expect(closedEpisodeService.moveStage('student-1', { stageId: 's2' })).rejects.toThrow('closed');
      expect(prisma.readingClubMembership.update).not.toHaveBeenCalled();
    });
  });

  describe('getMembershipOrThrow', () => {
    it('throws NotFoundException when the reader has no membership at all', async () => {
      prisma.readingClubMembership.findUnique.mockResolvedValue(null);
      await expect(service.getMembershipOrThrow('student-1')).rejects.toThrow('no reading-club membership');
    });

    it('throws ConflictException when the membership has no current stage (group finished)', async () => {
      prisma.readingClubMembership.findUnique.mockResolvedValue({ studentId: 'student-1', currentStageId: null });
      await expect(service.getMembershipOrThrow('student-1')).rejects.toThrow('no current stage');
    });
  });

  describe('getReaderDetail -> syncStageBookEntries (auto-sync of book entries)', () => {
    const student = { id: 'student-1', userId: 'user-1', code: 'STU1', className: '3A' };
    const membership = {
      studentId: 'student-1',
      episodeId: 'ep-current',
      groupId: 'g1',
      currentStageId: 's1',
      stageStartedAt: new Date('2026-01-01T00:00:00Z'),
      manualProgressAmount: 0,
    };
    const stage = { id: 's1', groupId: 'g1', stageOrder: 1, targetType: 'books', targetAmount: 3 };

    beforeEach(() => {
      prisma.libraryStudent.findUnique.mockResolvedValue(student);
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'Reader One' });
      prisma.readingClubMembership.findUnique.mockResolvedValue(membership);
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1', name: 'Group 1' });
      prisma.readingClubStage.findUnique.mockResolvedValue(stage);
      prisma.libraryBorrowing.count.mockResolvedValue(1);
    });

    it('syncs a returned borrowing inside the stage window into a new auto book-entry', async () => {
      const borrowing = { id: 'b1', bookCopyId: 'copy-1', studentId: 'student-1', status: 'returned', returnedAt: new Date('2026-01-05') };
      prisma.libraryBorrowing.findMany.mockResolvedValue([borrowing]);
      prisma.readingClubStageBookEntry.findMany.mockResolvedValue([]); // nothing synced yet
      prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue({ id: 'copy-1', bookId: 'book-1', qrCode: 'QR1' });
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1', title: 'Some Book' });

      await service.getReaderDetail('student-1', 'librarian-1');

      expect(prisma.readingClubStageBookEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studentId: 'student-1',
          episodeId: 'ep-current',
          groupId: 'g1',
          stageId: 's1',
          borrowingId: 'b1',
          bookTitle: 'Some Book',
          bookCode: 'QR1',
          source: 'auto',
          addedBy: 'librarian-1',
        }),
      });
    });

    it('does NOT re-sync a borrowing that already has an entry, even if that entry is discarded', async () => {
      const borrowing = { id: 'b1', bookCopyId: 'copy-1', studentId: 'student-1', status: 'returned', returnedAt: new Date('2026-01-05') };
      prisma.libraryBorrowing.findMany.mockResolvedValue([borrowing]);
      // Dedup lookup returns an existing (discarded) entry for this borrowing_id:
      prisma.readingClubStageBookEntry.findMany.mockResolvedValue([{ borrowingId: 'b1' }]);

      await service.getReaderDetail('student-1', 'librarian-1');

      expect(prisma.readingClubStageBookEntry.create).not.toHaveBeenCalled();
    });

    it('skips the sync entirely when no actingUserId is passed', async () => {
      prisma.libraryBorrowing.findMany.mockResolvedValue([{ id: 'b1', bookCopyId: 'copy-1', status: 'returned', returnedAt: new Date() }]);

      await service.getReaderDetail('student-1', null);

      expect(prisma.libraryBorrowing.findMany).not.toHaveBeenCalled();
      expect(prisma.readingClubStageBookEntry.create).not.toHaveBeenCalled();
    });
  });
});
