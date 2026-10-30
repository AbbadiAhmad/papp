import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { hashConfirmationToken } from '../../../src/core/notifications/confirmation.util';
import { PasswordResetService } from '../../../src/core/auth/password-reset.service';

const POLICY = { minLength: 8, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSymbol: false, maxFailedAttempts: 5, lockoutMinutes: 15, expiryDays: 0 };

describe('PasswordResetService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let settings: { get: jest.Mock };
  let email: { send: jest.Mock };
  let audit: { write: jest.Mock };
  let service: PasswordResetService;
  const user = { id: 'u1', email: 'a@x.test', name: 'Alice', isActive: true };

  beforeEach(() => {
    process.env.APP_PUBLIC_URL = 'https://app.test';
    prisma = {
      user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn((x) => x) },
      passwordResetToken: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn((x) => x) },
      userSession: { updateMany: jest.fn((x) => x) },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    settings = { get: jest.fn(async (key: string) => (key === 'auth.password_reset' ? { linkTtlMinutes: 30 } : POLICY)) };
    email = { send: jest.fn(async () => true) };
    audit = { write: jest.fn() };
    service = new PasswordResetService(prisma, settings as never, email as never, audit as never);
  });

  describe('request', () => {
    it('does nothing (and says nothing) for an unknown or inactive address', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await service.request('nobody@x.test', '1.2.3.4');
      expect(email.send).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('stores only the hash of a fresh token and emails the link, replacing older links', async () => {
      prisma.user.findFirst.mockResolvedValue(user);
      prisma.passwordResetToken.findFirst.mockResolvedValue(null);
      await service.request('A@x.test', '1.2.3.4');

      const created = prisma.passwordResetToken.create.mock.calls[0][0].data;
      const sent = email.send.mock.calls[0][0];
      const token = decodeURIComponent(/reset-password\?token=([^)\s\]]+)\)/.exec(sent.text)![1]);
      expect(created.tokenHash).toBe(hashConfirmationToken(token));
      expect(sent.text).not.toContain(created.tokenHash);
      expect(sent.to).toBe('a@x.test');
      expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
      expect(created.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', usedAt: null }, data: { usedAt: expect.any(Date) } });
      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'password_reset_requested', entityId: 'u1' }));
    });

    it('ignores a repeat request made within a minute', async () => {
      prisma.user.findFirst.mockResolvedValue(user);
      prisma.passwordResetToken.findFirst.mockResolvedValue({ id: 't' });
      await service.request('a@x.test', null);
      expect(email.send).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    const valid = { id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 60_000) };

    it.each([
      ['unknown token', null],
      ['used token', { ...valid, usedAt: new Date() }],
      ['expired token', { ...valid, expiresAt: new Date(Date.now() - 1000) }],
    ])('rejects a %s', async (_name, row) => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(row);
      await expect(service.complete('tokentokentoken', 'Newpassw0rd!', null)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a password that breaks the live policy', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(service.complete('tokentokentoken', 'short', null)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('sets the new password, clears lockout, burns the links and signs the user out everywhere', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);
      prisma.user.findUnique.mockResolvedValue(user);
      await service.complete('tokentokentoken', 'Newpassw0rd!', '1.2.3.4');

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashConfirmationToken('tokentokentoken') } });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(await argon2.verify(data.passwordHash, 'Newpassw0rd!')).toBe(true);
      expect(data).toMatchObject({ mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null });
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'password_reset', entityId: 'u1' }));
    });
  });
});
