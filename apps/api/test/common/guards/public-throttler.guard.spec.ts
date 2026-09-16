import { ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PublicThrottlerGuard } from '../../../src/common/guards/public-throttler.guard';
import { PUBLIC_ENDPOINT_RATE_LIMIT_KEY, PublicEndpointRateLimit } from '../../../src/core/settings/settings.types';

interface MockSettings {
  get: jest.Mock;
}

function createContext(ip: string, overrides: Record<string, unknown> = {}): ExecutionContext {
  const request = { ip, method: 'POST', url: '/auth/register', socket: {}, ...overrides };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => ({}) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function createMockSettings(config: PublicEndpointRateLimit): MockSettings {
  return {
    get: jest.fn((key: string) => {
      if (key === PUBLIC_ENDPOINT_RATE_LIMIT_KEY) return Promise.resolve(config);
      throw new Error(`Unexpected settings key in test: ${key}`);
    }),
  };
}

describe('PublicThrottlerGuard', () => {
  let settings: MockSettings;
  let guard: PublicThrottlerGuard;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows requests from a single IP while under the configured limit', async () => {
    settings = createMockSettings({ limit: 3, windowSeconds: 60 });
    guard = new PublicThrottlerGuard(settings as never);
    const context = createContext('203.0.113.1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throws 429 Too Many Requests once the IP reaches the limit within the window', async () => {
    settings = createMockSettings({ limit: 2, windowSeconds: 60 });
    guard = new PublicThrottlerGuard(settings as never);
    const context = createContext('203.0.113.2');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    const thirdCall = guard.canActivate(context);
    await expect(thirdCall).rejects.toBeInstanceOf(HttpException);
    await expect(thirdCall).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('allows requests again once the sliding window has fully expired', async () => {
    settings = createMockSettings({ limit: 1, windowSeconds: 60 });
    guard = new PublicThrottlerGuard(settings as never);
    const context = createContext('203.0.113.3');
    const fixedNow = 1_700_000_000_000;

    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    jest.spyOn(Date, 'now').mockReturnValue(fixedNow + 1_000); // still inside the 60s window
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);

    jest.spyOn(Date, 'now').mockReturnValue(fixedNow + 61_000); // window has fully rolled over
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('tracks different client IPs independently', async () => {
    settings = createMockSettings({ limit: 1, windowSeconds: 60 });
    guard = new PublicThrottlerGuard(settings as never);
    const fixedNow = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    await expect(guard.canActivate(createContext('198.51.100.10'))).resolves.toBe(true);
    // A different IP is not affected by the first IP already being at its limit.
    await expect(guard.canActivate(createContext('198.51.100.20'))).resolves.toBe(true);
    // The first IP, hit again, is still over its own limit.
    await expect(guard.canActivate(createContext('198.51.100.10'))).rejects.toBeInstanceOf(HttpException);
  });

  it('reads the limit setting fresh on every call — a change takes effect immediately, not just at construction', async () => {
    settings = createMockSettings({ limit: 1, windowSeconds: 60 });
    guard = new PublicThrottlerGuard(settings as never);
    const context = createContext('203.0.113.4');
    const fixedNow = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    await expect(guard.canActivate(context)).resolves.toBe(true); // 1st request, limit 1: allowed
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException); // 2nd, still limit 1: blocked

    // An admin raises the limit — the very next call must see it, with no
    // guard reconstruction and no cache of the OLD limit at construction time.
    settings.get.mockImplementation((key: string) => {
      if (key === PUBLIC_ENDPOINT_RATE_LIMIT_KEY) return Promise.resolve({ limit: 5, windowSeconds: 60 });
      throw new Error(`Unexpected settings key in test: ${key}`);
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(settings.get).toHaveBeenCalledTimes(3);
  });
});
