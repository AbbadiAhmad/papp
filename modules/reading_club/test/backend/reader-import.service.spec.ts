import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ReaderImportService } from '../../backend/reader-import.service';

const GROUP = { id: 'g1', name: 'Eagles', episodeId: 'ep1', isActive: true };
const STAGES = [
  { id: 's1', groupId: 'g1', stageOrder: 1, name: 'Bronze' },
  { id: 's2', groupId: 'g1', stageOrder: 2, name: 'Silver' },
];

function build(currentEpisode: { id: string } | null = { id: 'ep1' }) {
  const prisma = {
    readingClubGroup: { findMany: jest.fn(async () => [GROUP]) },
    readingClubStage: { findMany: jest.fn(async () => STAGES) },
    readingClubMembership: { findUnique: jest.fn(async (): Promise<unknown> => null) },
  };
  const episodes = { findCurrentEpisodeOrNull: jest.fn(async () => currentEpisode) };
  const memberships = { assign: jest.fn(async () => undefined), moveStage: jest.fn(async () => undefined), removeMembership: jest.fn(async () => undefined) };
  const service = new ReaderImportService(episodes as never, memberships as never);
  (service as unknown as { prisma: unknown }).prisma = prisma;
  return { service, prisma, memberships };
}

const row = (over: Record<string, unknown>) => ({ row: 2, club: null, clubGroup: null, clubStage: null, ...over });

describe('ReaderImportService', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  describe('validate', () => {
    it('ignores rows without club data', async () => {
      expect(await ctx.service.validate([row({})])).toEqual([]);
    });

    it('fails every club row when there is no current episode', async () => {
      const { service } = build(null);
      const errors = await service.validate([row({ clubGroup: 'Eagles' })]);
      expect(errors[0].error).toMatch(/No current reading-club episode/);
    });

    it('accepts a known group and a stage given by name or order number', async () => {
      expect(await ctx.service.validate([row({ clubGroup: 'eagles', clubStage: 'Silver' }), row({ row: 3, clubGroup: 'Eagles', clubStage: '2' })])).toEqual([]);
    });

    it('reports an unknown group, an unknown stage, and a stage without a group', async () => {
      const errors = await ctx.service.validate([
        row({ row: 2, clubGroup: 'Hawks' }),
        row({ row: 3, clubGroup: 'Eagles', clubStage: 'Gold' }),
        row({ row: 4, clubStage: 'Silver' }),
        row({ row: 5, club: false, clubGroup: 'Eagles' }),
      ]);
      expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    });
  });

  describe('apply', () => {
    it('assigns a new member to the group, defaulting to the first stage', async () => {
      await ctx.service.apply([{ ...row({ clubGroup: 'Eagles' }), studentId: 'st1' }], 'admin');
      expect(ctx.memberships.assign).toHaveBeenCalledWith({ studentId: 'st1', groupId: 'g1', stageId: undefined }, 'admin');
    });

    it('moves an existing member of the same group to another stage instead of re-assigning (keeps progress)', async () => {
      ctx.prisma.readingClubMembership.findUnique.mockResolvedValue({ episodeId: 'ep1', groupId: 'g1', currentStageId: 's1' });
      await ctx.service.apply([{ ...row({ clubGroup: 'Eagles', clubStage: 'Silver' }), studentId: 'st1' }], 'admin');
      expect(ctx.memberships.moveStage).toHaveBeenCalledWith('st1', { stageId: 's2' });
      expect(ctx.memberships.assign).not.toHaveBeenCalled();
    });

    it('does nothing when the member is already in that group and stage', async () => {
      ctx.prisma.readingClubMembership.findUnique.mockResolvedValue({ episodeId: 'ep1', groupId: 'g1', currentStageId: 's2' });
      await ctx.service.apply([{ ...row({ clubGroup: 'Eagles', clubStage: '2' }), studentId: 'st1' }], 'admin');
      expect(ctx.memberships.moveStage).not.toHaveBeenCalled();
      expect(ctx.memberships.assign).not.toHaveBeenCalled();
    });

    it('Club = no removes an existing member and is a no-op for a non-member', async () => {
      await ctx.service.apply([{ ...row({ club: false }), studentId: 'st1' }], 'admin');
      expect(ctx.memberships.removeMembership).not.toHaveBeenCalled();
      ctx.prisma.readingClubMembership.findUnique.mockResolvedValue({ episodeId: 'ep1', groupId: 'g1', currentStageId: 's1' });
      await ctx.service.apply([{ ...row({ club: false }), studentId: 'st1' }], 'admin');
      expect(ctx.memberships.removeMembership).toHaveBeenCalledWith('st1');
    });
  });
});
