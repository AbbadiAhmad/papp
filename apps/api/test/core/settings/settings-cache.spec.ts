import { InternalServerErrorException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SettingsService } from '../../../src/core/settings/settings.service';

interface MockPrisma {
  systemSetting: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    systemSetting: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

describe('SettingsService per-key cache (Phase 4 upgrade)', () => {
  let prisma: MockPrisma;
  let writer: { write: jest.Mock };
  let service: SettingsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    writer = { write: jest.fn() };
    writer.write.mockResolvedValue(undefined);
    service = new SettingsService(prisma as never, writer as never);
  });

  it('serves the second get() of the same key from cache — exactly one findUnique', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ key: 'auth.password_policy', value: { minLength: 8 } });

    await expect(service.get('auth.password_policy')).resolves.toEqual({ minLength: 8 });
    await expect(service.get('auth.password_policy')).resolves.toEqual({ minLength: 8 });

    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  it('set() invalidates the key — the next get() re-reads what the DB persisted', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ key: 'auth.password_policy', value: { minLength: 8 } });
    await service.get('auth.password_policy');
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(1);

    prisma.systemSetting.upsert.mockResolvedValue({});
    await service.set('auth.password_policy', { minLength: 12 }, 'admin-1');

    // set() does findUnique once itself (for the audit old-value)...
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(2);

    // ...and the next get() must hit the DB again, not the stale cache.
    prisma.systemSetting.findUnique.mockResolvedValue({ key: 'auth.password_policy', value: { minLength: 12 } });
    await expect(service.get('auth.password_policy')).resolves.toEqual({ minLength: 12 });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(3);
  });

  it('caches different keys independently — invalidating one leaves the other cached', async () => {
    prisma.systemSetting.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve({ key: where.key, value: `value-of-${where.key}` }),
    );

    await expect(service.get('key.a')).resolves.toBe('value-of-key.a');
    await expect(service.get('key.b')).resolves.toBe('value-of-key.b');
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(2);

    prisma.systemSetting.upsert.mockResolvedValue({});
    await service.set('key.a', 'new-a', 'admin-1'); // +1 findUnique (audit old value)

    await expect(service.get('key.b')).resolves.toBe('value-of-key.b'); // still cached
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(3);

    await service.get('key.a'); // invalidated → re-read
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(4);
  });

  it('a missing key throws and is NOT cached — the second call queries (and throws) again', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);

    await expect(service.get('auth.never_seeded')).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(service.get('auth.never_seeded')).rejects.toThrow(/auth\.never_seeded/);

    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(2);
  });

  describe('set() audit (Phase 3 retrofit)', () => {
    it("writes an actor_type='user' audit row with old/new values when updatedBy is present", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ key: 'auth.password_policy', value: { minLength: 8 } });
      prisma.systemSetting.upsert.mockResolvedValue({});

      await service.set('auth.password_policy', { minLength: 12 }, 'admin-1');

      expect(writer.write).toHaveBeenCalledTimes(1);
      expect(writer.write).toHaveBeenCalledWith({
        actorType: 'user',
        actorUserId: 'admin-1',
        actorSessionId: null,
        category: 'core.settings',
        entityType: 'SystemSetting',
        entityId: 'auth.password_policy',
        action: 'update',
        oldValue: { value: { minLength: 8 } },
        newValue: { value: { minLength: 12 } },
      });
    });

    it("writes an actor_type='system' create row when the key is new and updatedBy is absent", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);
      prisma.systemSetting.upsert.mockResolvedValue({});

      await service.set('notifications.categories', { 'auth.password_reset': { email: true } });

      expect(writer.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'system',
          actorUserId: null,
          action: 'create',
          oldValue: null,
        }),
      );
    });
  });

  describe('Phase-1-era constructor compatibility', () => {
    it('new SettingsService(prisma) still works — set() logs the missing writer instead of throwing', async () => {
      // This test deliberately hits the UNAUDITED-write error log — capture
      // it (and assert it fired) instead of spamming the run's stderr.
      const loggedErrors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const legacy = new SettingsService(prisma as never);
        prisma.systemSetting.findUnique.mockResolvedValue(null);
        prisma.systemSetting.upsert.mockResolvedValue({});

        await expect(legacy.set('auth.token_lifetimes', { accessTokenMinutes: 15 })).resolves.toBeUndefined();
        expect(prisma.systemSetting.upsert).toHaveBeenCalledTimes(1);
        expect(loggedErrors).toHaveBeenCalledWith(expect.stringContaining('UNAUDITED'));
      } finally {
        loggedErrors.mockRestore();
      }
    });
  });
});
