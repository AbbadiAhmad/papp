import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MembershipsService } from '../../backend/memberships.service';

interface MockPrisma {
  readingClubGroup: { findUnique: jest.Mock };
  readingClubStage: { findUnique: jest.Mock; findFirst: jest.Mock };
  readingClubMembership: { findUnique: jest.Mock; findMany: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  libraryStudent: { findUnique: jest.Mock; findMany: jest.Mock };
  user: { findUnique: jest.Mock; findMany: jest.Mock };
  libraryBorrowing: { count: jest.Mock };
}

function createMockPrisma(): MockPrisma {
  return {
    readingClubGroup: { findUnique: jest.fn() },
    readingClubStage: { findUnique: jest.fn(), findFirst: jest.fn() },
    readingClubMembership: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    libraryStudent: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    libraryBorrowing: { count: jest.fn() },
  };
}

function buildService(prisma: MockPrisma): MembershipsService {
  const service = new MembershipsService();
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
    it('defaults to the group\'s first stage when no stageId is given', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1' });
      prisma.readingClubStage.findFirst.mockResolvedValue({ id: 'stage-1', groupId: 'g1', stageOrder: 1 });
      prisma.readingClubMembership.upsert.mockResolvedValue({ studentId: 'student-1', groupId: 'g1', currentStageId: 'stage-1' });

      await service.assign({ studentId: 'student-1', groupId: 'g1' }, 'librarian-1');

      expect(prisma.readingClubStage.findFirst).toHaveBeenCalledWith({ where: { groupId: 'g1' }, orderBy: { stageOrder: 'asc' } });
      expect(prisma.readingClubMembership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { studentId: 'student-1' },
          create: expect.objectContaining({ groupId: 'g1', currentStageId: 'stage-1', manualProgressAmount: 0, assignedBy: 'librarian-1' }),
        }),
      );
    });

    it('rejects when the given stage does not belong to the target group', async () => {
      prisma.readingClubGroup.findUnique.mockResolvedValue({ id: 'g1' });
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
  });

  describe('moveStage', () => {
    it('rejects moving to a stage in a different group', async () => {
      prisma.readingClubMembership.findUnique.mockResolvedValue({ studentId: 'student-1', groupId: 'g1', currentStageId: 's1' });
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's2', groupId: 'OTHER_GROUP' });

      await expect(service.moveStage('student-1', { stageId: 's2' })).rejects.toThrow('current group');
      expect(prisma.readingClubMembership.update).not.toHaveBeenCalled();
    });

    it('moves within the same group and resets progress anchors', async () => {
      prisma.readingClubMembership.findUnique.mockResolvedValue({ studentId: 'student-1', groupId: 'g1', currentStageId: 's1' });
      prisma.readingClubStage.findUnique.mockResolvedValue({ id: 's2', groupId: 'g1' });
      prisma.readingClubMembership.update.mockResolvedValue({ studentId: 'student-1', currentStageId: 's2' });

      await service.moveStage('student-1', { stageId: 's2' });

      expect(prisma.readingClubMembership.update).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        data: expect.objectContaining({ currentStageId: 's2', manualProgressAmount: 0 }),
      });
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
});
