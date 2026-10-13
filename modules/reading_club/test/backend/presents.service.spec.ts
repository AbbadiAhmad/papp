import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EpisodesService } from '../../backend/episodes.service';
import { PresentsService } from '../../backend/presents.service';

function build(membership: unknown, current = true) {
  const prisma = {
    libraryStudent: { findUnique: jest.fn(async () => ({ id: 'st' })) },
    readingClubMembership: { findUnique: jest.fn(async () => membership) },
    readingClubPresent: { create: jest.fn(async (args: unknown) => args) },
  };
  const episodes = {
    getEpisodeOrThrow: jest.fn(async () => ({ id: 'ep-1', name: 'Season 1' })),
    getCurrentEpisode: jest.fn(async () => ({ id: 'ep-1', name: 'Season 1' })),
    assertEpisodeIsCurrent: jest.fn(async () => {
      if (!current) throw new Error('closed');
    }),
  };
  const publish = jest.fn(async () => undefined);
  const service = new PresentsService(episodes as unknown as EpisodesService, { publish });
  (service as unknown as { prisma: typeof prisma }).prisma = prisma;
  return { service, prisma, publish };
}

describe('PresentsService', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build({ episodeId: 'ep-1', groupName: 'G1', stageName: 'S1' });
  });

  it('records the present with a JSON snapshot of episode/group/stage and emits reward_given', async () => {
    await ctx.service.give('st', { description: '  Book voucher ' }, 'lib-1');
    expect(ctx.prisma.readingClubPresent.create).toHaveBeenCalledWith({
      data: {
        studentId: 'st',
        episodeId: 'ep-1',
        description: 'Book voucher',
        context: { episodeName: 'Season 1', groupName: 'G1', stageName: 'S1' },
        givenBy: 'lib-1',
      },
    });
    expect(ctx.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'reward_given', studentId: 'st' }));
  });

  it('rejects giving a present in a closed episode', async () => {
    const closed = build({ episodeId: 'ep-old' }, false);
    await expect(closed.service.give('st', { description: 'x' }, 'lib-1')).rejects.toThrow('closed');
    expect(closed.prisma.readingClubPresent.create).not.toHaveBeenCalled();
  });
});
