import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { contentHash, hashConfirmationToken } from '../../../src/core/notifications/confirmation.util';
import { NotificationConfirmationsService } from '../../../src/core/notifications/notification-confirmations.service';

const user = { id: 'u1', name: 'Alice', email: 'alice@papp.local' };

function recipient(overrides: Record<string, unknown> = {}) {
  return {
    notificationId: 'n1',
    userId: 'u1',
    readAt: null,
    confirmationExpiresAt: new Date(Date.now() + 86_400_000),
    notification: {
      id: 'n1',
      title: 'Policy for {{name}}',
      bodyMarkdown: 'Hello {{name}}, please accept.',
      requiresConfirmation: true,
      confirmationType: 'policy_acceptance',
      confirmationAllowComment: true,
    },
    ...overrides,
  };
}

describe('NotificationConfirmationsService', () => {
  let prisma: any;
  let writer: { write: jest.Mock };
  let service: NotificationConfirmationsService;
  const meta = { ipAddress: '203.0.113.7', userAgent: 'jest' };

  beforeEach(() => {
    prisma = {
      notificationRecipient: { findFirst: jest.fn(), update: jest.fn() },
      notificationConfirmation: { findUnique: jest.fn(), create: jest.fn(), count: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.notificationConfirmation.findUnique.mockResolvedValue(null);
    prisma.notificationConfirmation.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'c1', confirmedAt: new Date('2026-10-16T10:00:00Z'), ...data }),
    );
    writer = { write: jest.fn() };
    writer.write.mockResolvedValue(undefined);
    const settings = { get: jest.fn().mockResolvedValue({ linkTtlDays: 14 }) };
    service = new NotificationConfirmationsService(prisma, settings as never, writer as never);
  });

  it('issueToken stores only the hash and an expiry from the setting', async () => {
    const token = await service.issueToken('n1', 'u1');
    const data = prisma.notificationRecipient.update.mock.calls[0][0].data;
    expect(data.confirmationTokenHash).toBe(hashConfirmationToken(token));
    expect(data.confirmationTokenHash).not.toContain(token);
    expect(data.confirmationExpiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
  });

  it('an unknown token (or a notification not asking for confirmation) is a 404', async () => {
    prisma.notificationRecipient.findFirst.mockResolvedValue(null);
    await expect(service.preview('nope')).rejects.toBeInstanceOf(NotFoundException);
    prisma.notificationRecipient.findFirst.mockResolvedValue(
      recipient({ notification: { ...recipient().notification, requiresConfirmation: false } }),
    );
    await expect(service.confirm('x', undefined, meta)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preview substitutes the recipient name and flags an expired link', async () => {
    prisma.notificationRecipient.findFirst.mockResolvedValue(
      recipient({ confirmationExpiresAt: new Date(Date.now() - 1000) }),
    );
    const p = await service.preview('t');
    expect(p.title).toBe('Policy for Alice');
    expect(p.expired).toBe(true);
    expect(p.confirmedAt).toBeNull();
  });

  it('confirm stores the full evidence: time, IP, user agent, exact text, hash, confirmer, comment', async () => {
    prisma.notificationRecipient.findFirst.mockResolvedValue(recipient());
    const result = await service.confirm('t', '  I agree  ', meta);

    const data = prisma.notificationConfirmation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      notificationId: 'n1',
      userId: 'u1',
      confirmationType: 'policy_acceptance',
      ipAddress: '203.0.113.7',
      userAgent: 'jest',
      notificationTitle: 'Policy for Alice',
      notificationBodyMarkdown: 'Hello Alice, please accept.',
      contentSha256: contentHash('Policy for Alice', 'Hello Alice, please accept.'),
      confirmerName: 'Alice',
      confirmerEmail: 'alice@papp.local',
      comment: 'I agree',
    });
    expect(result.confirmationType).toBe('policy_acceptance');
    // marks the inbox row read
    expect(prisma.notificationRecipient.update).toHaveBeenCalled();
    // audited as anonymous, and the token never reaches the audit row
    const audit = writer.write.mock.calls[0][0] as any;
    expect(audit).toMatchObject({ actorType: 'anonymous', action: 'confirm', entityType: 'NotificationConfirmation', ipAddress: '203.0.113.7' });
    expect(JSON.stringify(audit)).not.toContain('"t"');
  });

  it('drops the comment when the notification does not allow one', async () => {
    prisma.notificationRecipient.findFirst.mockResolvedValue(
      recipient({ notification: { ...recipient().notification, confirmationAllowComment: false } }),
    );
    await service.confirm('t', 'sneaky', meta);
    expect(prisma.notificationConfirmation.create.mock.calls[0][0].data.comment).toBeNull();
  });

  it('refuses a second confirmation (409) and an expired link (410) and writes nothing', async () => {
    prisma.notificationRecipient.findFirst.mockResolvedValue(recipient());
    prisma.notificationConfirmation.findUnique.mockResolvedValue({ confirmedAt: new Date() });
    await expect(service.confirm('t', undefined, meta)).rejects.toBeInstanceOf(ConflictException);

    prisma.notificationConfirmation.findUnique.mockResolvedValue(null);
    prisma.notificationRecipient.findFirst.mockResolvedValue(
      recipient({ confirmationExpiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(service.confirm('t', undefined, meta)).rejects.toBeInstanceOf(GoneException);
    expect(prisma.notificationConfirmation.create).not.toHaveBeenCalled();
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('a concurrent double submit (unique violation) is reported as already confirmed', async () => {
    prisma.notificationRecipient.findFirst.mockResolvedValue(recipient());
    prisma.notificationConfirmation.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.confirm('t', undefined, meta)).rejects.toBeInstanceOf(ConflictException);
  });

  it('hasConfirmed answers per user and type (for e.g. registration acceptance)', async () => {
    prisma.notificationConfirmation.count.mockResolvedValue(1);
    await expect(service.hasConfirmed('u1', 'policy_acceptance')).resolves.toBe(true);
    expect(prisma.notificationConfirmation.count).toHaveBeenCalledWith({
      where: { userId: 'u1', confirmationType: 'policy_acceptance' },
    });
  });
});
