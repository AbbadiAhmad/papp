import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ClubEvent, ClubEventPublisher } from '../../backend/club-events';
import { EpisodesService } from '../../backend/episodes.service';
import { GroupsService } from '../../backend/groups.service';
import { MembershipsService } from '../../backend/memberships.service';
import { StageCompletionsService } from '../../backend/stage-completions.service';

/** Tier 1: verifies each write path announces the right club event (READING_CLUB-D20), with mocked Prisma. */

const currentEpisode = { assertEpisodeIsCurrent: jest.fn(async () => undefined) } as unknown as EpisodesService;
let published: ClubEvent[];
let events: ClubEventPublisher;

beforeEach(() => {
  published = [];
  events = { publish: jest.fn(async (e: ClubEvent) => void published.push(e)) };
});

function withPrisma<T>(service: T, prisma: object): T {
  (service as unknown as { prisma: object }).prisma = prisma;
  return service;
}

describe('MembershipsService events', () => {
  const group = { id: 'g1', episodeId: 'ep', name: 'Group A' };
  const firstStage = { id: 's1', name: 'Stage 1' };

  function build(existing: object | null) {
    const prisma = {
      readingClubGroup: { findUnique: jest.fn(async () => group) },
      readingClubStage: { findFirst: jest.fn(async () => firstStage), findUnique: jest.fn(async () => ({ id: 's2', name: 'Stage 2', groupId: 'g1' })) },
      readingClubMembership: {
        findUnique: jest.fn(async () => existing),
        upsert: jest.fn(async () => ({ studentId: 'st' })),
        update: jest.fn(async () => ({ studentId: 'st' })),
        delete: jest.fn(async (_args: unknown) => ({})),
      },
    };
    return { prisma, service: withPrisma(new MembershipsService(currentEpisode, events), prisma) };
  }

  it('assign of a new reader emits reader_added', async () => {
    await build(null).service.assign({ studentId: 'st', groupId: 'g1' }, 'staff');
    expect(published).toEqual([expect.objectContaining({ type: 'reader_added', studentId: 'st' })]);
  });

  it('assign of an already-enrolled reader emits reader_moved', async () => {
    await build({ studentId: 'st' }).service.assign({ studentId: 'st', groupId: 'g1' }, 'staff');
    expect(published[0]).toMatchObject({ type: 'reader_moved', studentId: 'st' });
  });

  it('moveStage emits reader_moved', async () => {
    await build({ studentId: 'st', episodeId: 'ep', groupId: 'g1', currentStageId: 's1', groupName: 'Group A' }).service.moveStage('st', { stageId: 's2' });
    expect(published[0]).toMatchObject({ type: 'reader_moved', studentId: 'st' });
  });

  it('removeMembership deletes only the membership and emits reader_removed', async () => {
    const { service, prisma } = build({ studentId: 'st', episodeId: 'ep', groupId: 'g1', currentStageId: 's1', groupName: 'Group A' });
    await expect(service.removeMembership('st')).resolves.toEqual({ removed: true });
    expect(prisma.readingClubMembership.delete).toHaveBeenCalledWith({ where: { studentId: 'st' } });
    expect(published[0]).toMatchObject({ type: 'reader_removed', studentId: 'st' });
  });

  it('removeMembership rejects an unknown reader without emitting', async () => {
    await expect(build(null).service.removeMembership('st')).rejects.toThrow('no reading-club membership');
    expect(published).toEqual([]);
  });

  it('works with no publisher configured (event hook is optional)', async () => {
    const prisma = build(null).prisma;
    const service = withPrisma(new MembershipsService(currentEpisode), prisma);
    await expect(service.assign({ studentId: 'st', groupId: 'g1' }, 'staff')).resolves.toBeDefined();
  });
});

describe('GroupsService events', () => {
  const group = { id: 'g1', episodeId: 'ep', name: 'Group A', stages: [] };
  const stage = { id: 's1', groupId: 'g1', name: 'Stage 1' };
  const prisma = () => ({
    readingClubGroup: {
      findUnique: jest.fn(async () => group),
      create: jest.fn(async () => group),
      update: jest.fn(async () => group),
      delete: jest.fn(async () => group),
    },
    readingClubStage: {
      findUnique: jest.fn(async () => stage),
      create: jest.fn(async () => stage),
      update: jest.fn(async () => stage),
      delete: jest.fn(async () => stage),
      deleteMany: jest.fn(async () => ({})),
    },
    readingClubMembership: { count: jest.fn(async () => 2) },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  });

  it('emits one event per group/stage write', async () => {
    const service = withPrisma(new GroupsService({ ...currentEpisode, getCurrentEpisode: async () => ({ id: 'ep' }) } as unknown as EpisodesService, events), prisma());
    await service.createGroup({ name: 'Group A' } as never, 'staff');
    await service.updateGroup('g1', { name: 'Group A' } as never);
    await service.removeGroup('g1');
    await service.createStage('g1', { stageOrder: 1, name: 'Stage 1', targetType: 'books', targetAmount: 3 } as never);
    await service.updateStage('s1', { name: 'Stage 1' } as never);
    await service.removeStage('s1');
    expect(published.map((e) => e.type)).toEqual(['group_created', 'group_updated', 'group_deleted', 'stage_created', 'stage_updated', 'stage_deleted']);
  });

  it('does not emit when the write is rejected', async () => {
    const rejecting = { assertEpisodeIsCurrent: jest.fn(async () => { throw new Error('closed'); }) } as unknown as EpisodesService;
    const service = withPrisma(new GroupsService(rejecting, events), prisma());
    await expect(service.updateGroup('g1', {} as never)).rejects.toThrow('closed');
    expect(published).toEqual([]);
  });
});

describe('StageCompletionsService events', () => {
  it('markComplete emits stage_completed and confirmReward emits reward_given', async () => {
    const stage = { id: 's1', name: 'Stage 1', stageOrder: 1, targetAmount: 3, rewardDescription: 'Book' };
    const prisma = {
      readingClubStage: { findUnique: jest.fn(async () => stage), findFirst: jest.fn(async () => null) },
      readingClubGroup: { findUnique: jest.fn(async () => ({ name: 'Group A' })) },
      readingClubStageCompletion: {
        create: jest.fn(async () => ({ id: 'c1' })),
        findUnique: jest.fn(async () => ({ id: 'c1', studentId: 'st', rewardStatus: 'pending', groupName: 'Group A', stageName: 'Stage 1' })),
        update: jest.fn(async () => ({ id: 'c1' })),
      },
      readingClubMembership: { update: jest.fn(async () => ({})) },
      libraryStudent: { findUnique: jest.fn(async () => ({ userId: 'u' })) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const memberships = {
      getMembershipOrThrow: async () => ({ episodeId: 'ep', currentStageId: 's1', groupId: 'g1', groupName: 'Group A', stageStartedAt: new Date(), manualProgressAmount: 0 }),
      computeStageProgress: async () => ({ progressAmount: 3 }),
    } as unknown as MembershipsService;
    const service = withPrisma(new StageCompletionsService(memberships, currentEpisode, { send: jest.fn(async () => undefined) }, events), prisma);

    await service.markComplete('st', 'staff');
    await service.confirmReward('c1', 'staff');

    expect(published.map((e) => e.type)).toEqual(['stage_completed', 'reward_given']);
    expect(published[0].details).toContain('أنهى جميع المراحل'); // last stage: no next stage
  });
});

describe('EpisodesService events', () => {
  it('createEpisode emits episode_started', async () => {
    const prisma = {
      readingClubEpisode: { findFirst: jest.fn(async () => null), create: jest.fn(() => Promise.resolve({ id: 'e1' })) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const service = withPrisma(new EpisodesService(events), prisma);
    await service.createEpisode({ name: '2026' } as never, 'staff');
    expect(published[0]).toMatchObject({ type: 'episode_started' });
  });
});
