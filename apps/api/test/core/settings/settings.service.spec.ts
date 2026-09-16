import { InternalServerErrorException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SettingsService } from '../../../src/core/settings/settings.service';

// Phase 4 note: caching, invalidation, and audit-row behavior live in
// settings-cache.spec.ts — this file keeps the original Phase 1 read/write
// contract assertions, now constructed WITH a mocked AuditLogWriter so the
// (correct) "UNAUDITED write" error logging no longer fires during tests.

interface MockPrisma {
  systemSetting: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    systemSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

describe('SettingsService', () => {
  let prisma: MockPrisma;
  let writer: { write: jest.Mock };
  let service: SettingsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    writer = { write: jest.fn() };
    writer.write.mockResolvedValue(undefined);
    service = new SettingsService(prisma as never, writer as never);
  });

  describe('get', () => {
    it('returns the stored value for an existing key', async () => {
      const value = { minLength: 8, requireLetter: true, requireNumber: true, maxFailedAttempts: 5, lockoutMinutes: 15 };
      prisma.systemSetting.findUnique.mockResolvedValue({ key: 'auth.password_policy', value });

      await expect(service.get('auth.password_policy')).resolves.toEqual(value);
      expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: 'auth.password_policy' } });
    });

    it('throws when the key is missing instead of returning a default', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      await expect(service.get('auth.does_not_exist')).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(service.get('auth.does_not_exist')).rejects.toThrow(/auth\.does_not_exist/);
    });
  });

  describe('set', () => {
    it('upserts with the key/value/updatedBy shape on both branches', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);
      prisma.systemSetting.upsert.mockResolvedValue({});

      await service.set('auth.token_lifetimes', { accessTokenMinutes: 15 }, 'admin-user-id');

      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'auth.token_lifetimes' },
        update: { value: { accessTokenMinutes: 15 }, updatedBy: 'admin-user-id' },
        create: { key: 'auth.token_lifetimes', value: { accessTokenMinutes: 15 }, updatedBy: 'admin-user-id' },
      });
    });

    it('passes updatedBy through as undefined when the caller omits it', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);
      prisma.systemSetting.upsert.mockResolvedValue({});

      await service.set('auth.token_lifetimes', { accessTokenMinutes: 15 });

      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'auth.token_lifetimes' },
        update: { value: { accessTokenMinutes: 15 }, updatedBy: undefined },
        create: { key: 'auth.token_lifetimes', value: { accessTokenMinutes: 15 }, updatedBy: undefined },
      });
    });
  });
});
