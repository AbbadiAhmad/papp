import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ClubEventsService } from '../../backend/club-events.service';

interface MockPrisma {
  readingClubEventSubscription: { findMany: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
  libraryStudent: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  $transaction: jest.Mock;
}

function build(codesByUser: Record<string, string[]>) {
  const prisma: MockPrisma = {
    readingClubEventSubscription: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    libraryStudent: { findUnique: jest.fn(async () => ({ id: 'st-1', userId: 'u-r', code: 'STU-001' })) },
    user: { findUnique: jest.fn(async () => ({ name: 'Omar' })) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const send = jest.fn(async (_input: unknown) => undefined);
  const permissions = { getEffectivePermissionCodes: jest.fn(async (id: string) => new Set(codesByUser[id] ?? [])) };
  const service = new ClubEventsService({ send }, permissions);
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return { service, prisma, send };
}

describe('ClubEventsService', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build({ 'u-fin': ['reading_club.notifications.subscribe'], 'u-lost': [] });
  });

  it('notifies only subscribers who still hold the subscribe permission', async () => {
    ctx.prisma.readingClubEventSubscription.findMany.mockResolvedValue([
      { userId: 'u-fin', eventType: 'stage_completed' },
      { userId: 'u-lost', eventType: 'stage_completed' },
    ]);
    await ctx.service.publish({ type: 'stage_completed', studentId: 'st-1', details: 'x' });
    expect(ctx.send).toHaveBeenCalledTimes(1);
    expect(ctx.send).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'u-fin', category: 'reading_club.event.stage_completed' }));
  });

  it('does nothing without subscribers and never throws when sending fails', async () => {
    ctx.prisma.readingClubEventSubscription.findMany.mockResolvedValue([]);
    await expect(ctx.service.publish({ type: 'group_created' })).resolves.toBeUndefined();
    expect(ctx.send).not.toHaveBeenCalled();

    ctx.prisma.readingClubEventSubscription.findMany.mockResolvedValue([{ userId: 'u-fin', eventType: 'group_created' }]);
    ctx.send.mockRejectedValue(new Error('boom'));
    await expect(ctx.service.publish({ type: 'group_created' })).resolves.toBeUndefined();
  });

  it('rejects unknown event types when saving and replaces the whole set otherwise', async () => {
    await expect(ctx.service.setMySubscriptions('u-fin', ['nope'])).rejects.toThrow('Unknown club event type');
    const result = await ctx.service.setMySubscriptions('u-fin', ['reward_given', 'reward_given', 'stage_completed']);
    expect(result.subscribed).toEqual(['reward_given', 'stage_completed']);
    expect(ctx.prisma.readingClubEventSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-fin' } });
  });
});
