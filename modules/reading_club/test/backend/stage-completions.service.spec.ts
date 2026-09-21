import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { StageCompletionsService } from '../../backend/stage-completions.service';
import { MembershipsService } from '../../backend/memberships.service';
import type { NotificationsSender } from '../../backend/notifications-sender';

interface MockPrisma {
  readingClubStage: { findUnique: jest.Mock; findFirst: jest.Mock };
  readingClubStageCompletion: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  readingClubMembership: { update: jest.Mock };
  libraryStudent: { findUnique: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  return {
    readingClubStage: { findUnique: jest.fn(), findFirst: jest.fn() },
    readingClubStageCompletion: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    readingClubMembership: { update: jest.fn() },
    libraryStudent: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

function buildService(prisma: MockPrisma, memberships: Partial<MembershipsService>): StageCompletionsService {
  const notifications: NotificationsSender = { send: jest.fn(async () => undefined) };
  const service = new StageCompletionsService(memberships as MembershipsService, notifications);
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('StageCompletionsService', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('markComplete', () => {
    it('creates a pending completion snapshot and advances the membership to the next stage', async () => {
      const membership = { studentId: 'student-1', groupId: 'g1', currentStageId: 's1', stageStartedAt: new Date('2026-01-01'), manualProgressAmount: 0 };
      const stage = { id: 's1', groupId: 'g1', stageOrder: 1, name: 'Stage 1', targetAmount: 5, rewardDescription: 'Sticker pack' };
      const nextStage = { id: 's2', groupId: 'g1', stageOrder: 2 };
      const memberships: Partial<MembershipsService> = {
        getMembershipOrThrow: jest.fn(async () => membership) as unknown as MembershipsService['getMembershipOrThrow'],
        computeStageProgress: jest.fn(async () => ({ targetType: 'books', targetAmount: 5, progressAmount: 5, isComplete: true })) as unknown as MembershipsService['computeStageProgress'],
      };
      const service = buildService(prisma, memberships);

      prisma.readingClubStage.findUnique.mockResolvedValue(stage);
      prisma.readingClubStage.findFirst.mockResolvedValue(nextStage);
      prisma.readingClubStageCompletion.create.mockResolvedValue({ id: 'completion-1', rewardStatus: 'pending' });
      prisma.readingClubMembership.update.mockResolvedValue({ studentId: 'student-1', currentStageId: 's2' });
      prisma.libraryStudent.findUnique.mockResolvedValue({ id: 'student-1', userId: 'user-1' });

      const result = await service.markComplete('student-1', 'librarian-1');

      expect(prisma.readingClubStageCompletion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studentId: 'student-1',
          groupId: 'g1',
          stageId: 's1',
          targetAmountAtCompletion: 5,
          progressAmountAtCompletion: 5,
          markedBy: 'librarian-1',
          rewardStatus: 'pending',
        }),
      });
      expect(prisma.readingClubMembership.update).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        data: expect.objectContaining({ currentStageId: 's2', manualProgressAmount: 0 }),
      });
      expect(result).toEqual({ id: 'completion-1', rewardStatus: 'pending' });
    });

    it('advances to a null current stage when the finished stage was the last one in its group', async () => {
      const membership = { studentId: 'student-1', groupId: 'g1', currentStageId: 's2', stageStartedAt: new Date(), manualProgressAmount: 0 };
      const lastStage = { id: 's2', groupId: 'g1', stageOrder: 2, name: 'Stage 2', targetAmount: 10, rewardDescription: null };
      const memberships: Partial<MembershipsService> = {
        getMembershipOrThrow: jest.fn(async () => membership) as unknown as MembershipsService['getMembershipOrThrow'],
        computeStageProgress: jest.fn(async () => ({ targetType: 'books', targetAmount: 10, progressAmount: 10, isComplete: true })) as unknown as MembershipsService['computeStageProgress'],
      };
      const service = buildService(prisma, memberships);

      prisma.readingClubStage.findUnique.mockResolvedValue(lastStage);
      prisma.readingClubStage.findFirst.mockResolvedValue(null); // no next stage
      prisma.readingClubStageCompletion.create.mockResolvedValue({ id: 'completion-2' });
      prisma.readingClubMembership.update.mockResolvedValue({ studentId: 'student-1', currentStageId: null });
      prisma.libraryStudent.findUnique.mockResolvedValue(null);

      await service.markComplete('student-1', 'librarian-1');

      expect(prisma.readingClubMembership.update).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        data: expect.objectContaining({ currentStageId: null }),
      });
    });
  });

  describe('confirmReward', () => {
    it('rejects confirming a reward that was already delivered', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageCompletion.findUnique.mockResolvedValue({ id: 'c1', rewardStatus: 'delivered' });

      await expect(service.confirmReward('c1', 'librarian-1')).rejects.toThrow('already been confirmed');
      expect(prisma.readingClubStageCompletion.update).not.toHaveBeenCalled();
    });

    it('marks a pending reward delivered and records who/when', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageCompletion.findUnique.mockResolvedValue({ id: 'c1', studentId: 'student-1', rewardStatus: 'pending' });
      prisma.readingClubStageCompletion.update.mockResolvedValue({ id: 'c1', rewardStatus: 'delivered' });
      prisma.libraryStudent.findUnique.mockResolvedValue({ id: 'student-1', userId: 'user-1' });

      await service.confirmReward('c1', 'librarian-1');

      expect(prisma.readingClubStageCompletion.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({ rewardStatus: 'delivered', rewardDeliveredBy: 'librarian-1' }),
      });
    });

    it('throws NotFoundException for an unknown completion id', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageCompletion.findUnique.mockResolvedValue(null);
      await expect(service.confirmReward('missing', 'librarian-1')).rejects.toThrow('not found');
    });
  });

  describe('listPendingRewards', () => {
    it('returns [] without any further queries when there are no pending completions', async () => {
      const service = buildService(prisma, {});
      prisma.readingClubStageCompletion.findMany.mockResolvedValue([]);

      const result = await service.listPendingRewards('student-1');

      expect(result).toEqual([]);
    });
  });
});
