import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ReaderImportService, normalizeName } from '../../backend/reader-import.service';

const GROUP = { id: 'g1', name: 'Eagles', episodeId: 'ep1', isActive: true };
const STAGES = [
  { id: 's1', groupId: 'g1', stageOrder: 1, name: 'Bronze' },
  { id: 's2', groupId: 'g1', stageOrder: 2, name: 'Silver' },
];

function build(currentEpisode: { id: string } | null = { id: 'ep1' }) {
  const prisma = {
    readingClubGroup: { findMany: jest.fn(async () => [GROUP]) },
    readingClubStage: { findMany: jest.fn(async () => STAGES) },
    readingClubMembership: { findUnique: jest.fn(async (): Promise<unknown> => null), findMany: jest.fn(async (): Promise<unknown[]> => []) },
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

  describe('name matching (librarians type names, never IDs)', () => {
    it('ignores case, extra spaces, diacritics and common Arabic spelling variants', () => {
      expect(normalizeName('  Eagles  ')).toBe(normalizeName('eagles'));
      expect(normalizeName('الأَبطال')).toBe(normalizeName('الابطال'));
      expect(normalizeName('مجموعة   النسور')).toBe(normalizeName('مجموعة النسور'));
      expect(normalizeName('مدرسة')).toBe(normalizeName('مدرسه'));
    });

    it('accepts a padded / differently-cased group name', async () => {
      expect(await ctx.service.validate([row({ clubGroup: '  EAGLES ', clubStage: ' silver' })])).toEqual([]);
    });

    it('an unknown name lists the valid ones in the error', async () => {
      const [groupError] = await ctx.service.validate([row({ clubGroup: 'Hawks' })]);
      expect(groupError.error).toMatch(/Available groups: Eagles/);
      const [stageError] = await ctx.service.validate([row({ clubGroup: 'Eagles', clubStage: 'Gold' })]);
      expect(stageError.error).toMatch(/Available stages: Bronze, Silver/);
    });

    it('rejects two groups sharing the same name as ambiguous', async () => {
      ctx.prisma.readingClubGroup.findMany.mockResolvedValue([GROUP, { ...GROUP, id: 'g2' }]);
      const [e] = await ctx.service.validate([row({ clubGroup: 'Eagles' })]);
      expect(e.error).toMatch(/ambiguous/);
    });
  });

  describe('exportData', () => {
    it('returns current members with live group/stage names, and the valid groups with their stages', async () => {
      ctx.prisma.readingClubGroup.findMany.mockResolvedValue([{ ...GROUP, stages: STAGES }] as never);
      ctx.prisma.readingClubMembership.findMany.mockResolvedValue([
        { studentId: 'st1', groupId: 'g1', currentStageId: 's2', groupName: 'old name', stageName: 'old' },
        { studentId: 'st2', groupId: null, currentStageId: null, groupName: 'Deleted group', stageName: null },
      ]);
      const data = await ctx.service.exportData(['st1', 'st2', 'st3']);
      expect(data.members).toEqual({ st1: { group: 'Eagles', stage: 'Silver' }, st2: { group: 'Deleted group', stage: null } });
      expect(data.groups).toEqual([{ name: 'Eagles', stages: [{ order: 1, name: 'Bronze' }, { order: 2, name: 'Silver' }] }]);
    });

    it('is empty when there is no current episode', async () => {
      const { service } = build(null);
      expect(await service.exportData(['st1'])).toEqual({ members: {}, groups: [] });
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
