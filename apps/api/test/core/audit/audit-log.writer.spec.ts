import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { AuditLogWriter } from '../../../src/core/audit/audit-log.writer';

interface MockPrisma {
  auditLog: {
    create: jest.Mock;
  };
}

function createMockPrisma(): MockPrisma {
  return { auditLog: { create: jest.fn(async () => ({})) } };
}

const baseEntry = {
  actorType: 'user' as const,
  actorUserId: 'actor-1',
  actorSessionId: 'sess-1',
  category: 'core.users',
  entityType: 'User',
  entityId: 'user-9',
  action: 'update',
};

describe('AuditLogWriter', () => {
  let prisma: MockPrisma;
  let writer: AuditLogWriter;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma = createMockPrisma();
    writer = new AuditLogWriter(prisma as never);
  });

  it('redacts @Sensitive fields in old/new values UNCONDITIONALLY before prisma.auditLog.create', async () => {
    await writer.write({
      ...baseEntry,
      oldValue: { id: 'user-9', name: 'Before', passwordHash: 'bcrypt$old' },
      newValue: { id: 'user-9', name: 'After', session: { refreshTokenHash: 'rt-raw' } },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.auditLog.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.oldValue).toEqual({ id: 'user-9', name: 'Before', passwordHash: '[redacted]' });
    expect(data.newValue).toEqual({ id: 'user-9', name: 'After', session: { refreshTokenHash: '[redacted]' } });
  });

  it('normalizes values to JSON-plain (Dates become ISO strings) at the same funnel', async () => {
    await writer.write({ ...baseEntry, newValue: { updatedAt: new Date('2026-03-04T05:06:07.000Z') } });

    const { data } = prisma.auditLog.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.newValue).toEqual({ updatedAt: '2026-03-04T05:06:07.000Z' });
  });

  it('passes actor and entity fields through verbatim', async () => {
    await writer.write({ ...baseEntry, ipAddress: '198.51.100.7', userAgent: 'jest-agent/1.0' });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'user',
        actorUserId: 'actor-1',
        actorSessionId: 'sess-1',
        category: 'core.users',
        entityType: 'User',
        entityId: 'user-9',
        action: 'update',
        oldValue: Prisma.JsonNull,
        newValue: Prisma.JsonNull,
        ipAddress: '198.51.100.7',
        userAgent: 'jest-agent/1.0',
      },
    });
  });

  it('defaults omitted optional fields to null / Prisma.JsonNull', async () => {
    await writer.write({ actorType: 'anonymous', category: 'library.loans', entityType: 'Loan', action: 'create' });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'anonymous',
        actorUserId: null,
        actorSessionId: null,
        category: 'library.loans',
        entityType: 'Loan',
        entityId: null,
        action: 'create',
        oldValue: Prisma.JsonNull,
        newValue: Prisma.JsonNull,
        ipAddress: null,
        userAgent: null,
      },
    });
  });

  it('NEVER throws when prisma.auditLog.create rejects — it logs loudly instead', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma.auditLog.create.mockImplementation(async () => {
      throw new Error('connection lost');
    });

    await expect(writer.write({ ...baseEntry })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('UNAUDITED'), expect.stringContaining('connection lost'));
  });
});
