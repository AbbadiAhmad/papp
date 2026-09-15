import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AuditService, PurgeActor } from '../../../src/core/audit/audit.service';

interface MockPrisma {
  auditLog: {
    deleteMany: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  return {
    auditLog: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    $transaction: jest.fn(),
  };
}

const actor: PurgeActor = {
  userId: 'admin-1',
  sessionId: 'sess-1',
  ipAddress: '203.0.113.9',
  userAgent: 'jest-agent/1.0',
};

// Fixed "now": 2026-03-10 15:30 UTC → today (UTC) starts 2026-03-10T00:00Z,
// so 2026-03-09 is the newest acceptable cutoff (D25 boundary).
const FIXED_NOW = new Date('2026-03-10T15:30:00.000Z');

describe('AuditService.purge', () => {
  let prisma: MockPrisma;
  let writer: { write: jest.Mock };
  let service: AuditService;

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask'] });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = createMockPrisma();
    writer = { write: jest.fn(async () => undefined) };
    service = new AuditService(prisma as never, writer as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('cutoff validation (UTC, D25: the newest full day always survives)', () => {
    it('rejects today (UTC) even though local wall clocks elsewhere already read tomorrow', async () => {
      await expect(service.purge('2026-03-10', actor)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.purge('2026-03-10', actor)).rejects.toThrow(/yesterday \(UTC\) or earlier/);
      expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
      expect(writer.write).not.toHaveBeenCalled();
    });

    it('rejects tomorrow', async () => {
      await expect(service.purge('2026-03-11', actor)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects a malformed date string', async () => {
      await expect(service.purge('not-a-date', actor)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.purge('not-a-date', actor)).rejects.toThrow(/not a valid calendar date/);
      expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    });

    it('rolls an impossible-but-well-formed date forward rather than rejecting it (documented V8 behavior)', async () => {
      // `new Date('2026-02-30T00:00:00.000Z')` is NOT Invalid Date in V8 —
      // it rolls over to 2026-03-02. Harmless: the rolled date is still
      // capped at yesterday, and the DTO regex already pins the shape. This
      // test documents the actual contract so a future "fix" is deliberate.
      prisma.auditLog.deleteMany.mockImplementation(async () => ({ count: 1 }));

      await expect(service.purge('2026-02-30', actor)).resolves.toEqual({
        cutoffDate: '2026-02-30',
        rowsDeleted: 1,
      });
      expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: { occurredAt: { lt: new Date('2026-03-02T00:00:00.000Z') } },
      });
    });

    it('accepts yesterday — the exact boundary day', async () => {
      prisma.auditLog.deleteMany.mockImplementation(async () => ({ count: 3 }));

      await expect(service.purge('2026-03-09', actor)).resolves.toEqual({
        cutoffDate: '2026-03-09',
        rowsDeleted: 3,
      });
    });
  });

  it('deletes exactly the rows with occurred_at strictly BEFORE the cutoff midnight UTC', async () => {
    prisma.auditLog.deleteMany.mockImplementation(async () => ({ count: 12 }));

    await service.purge('2026-03-01', actor);

    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { occurredAt: { lt: new Date('2026-03-01T00:00:00.000Z') } },
    });
  });

  it('writes its own audit row AFTER deleteMany resolves, with the REAL deleted count', async () => {
    const events: string[] = [];
    prisma.auditLog.deleteMany.mockImplementation(async () => {
      // Real async gap: a self-row written before/concurrently would record
      // a count that does not exist yet.
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push('deleteMany:resolved');
      return { count: 42 };
    });
    writer.write.mockImplementation(async () => {
      events.push('selfRow:written');
    });

    const result = await service.purge('2026-03-05', actor);

    expect(events).toEqual(['deleteMany:resolved', 'selfRow:written']);
    expect(result).toEqual({ cutoffDate: '2026-03-05', rowsDeleted: 42 });
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith({
      actorType: 'user',
      actorUserId: 'admin-1',
      actorSessionId: 'sess-1',
      category: 'core.audit',
      entityType: 'AuditLog',
      entityId: null,
      action: 'purge',
      oldValue: null,
      newValue: { cutoffDate: '2026-03-05', rowsDeleted: 42 },
      ipAddress: '203.0.113.9',
      userAgent: 'jest-agent/1.0',
    });
  });

  it('a repeat purge deleting 0 rows still succeeds and is still self-audited', async () => {
    prisma.auditLog.deleteMany.mockImplementation(async () => ({ count: 0 }));

    const result = await service.purge('2026-03-05', actor);

    expect(result).toEqual({ cutoffDate: '2026-03-05', rowsDeleted: 0 });
    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'purge', newValue: { cutoffDate: '2026-03-05', rowsDeleted: 0 } }),
    );
  });
});
