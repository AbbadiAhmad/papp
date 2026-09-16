import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, getAccessToken, onAuthExpired, setAccessToken } from '../src/shared/api/httpClient';

/**
 * apiClient's 401-retry-refresh-dedup interceptor (shared/api/httpClient.ts).
 * No real network/backend: axios is given a CUSTOM `adapter` (its own
 * documented mocking mechanism) instead of a fetch/XHR mock, so these tests
 * exercise the REAL interceptor/refresh-dedup code, only swapping out the
 * transport at the bottom.
 *
 * `apiClient` is created via `axios.create(...)`, but `refreshAccessToken()`
 * (in httpClient.ts) calls plain `axios.post(...)` for `/auth/refresh` — so
 * both `apiClient.defaults.adapter` and the top-level `axios.defaults.adapter`
 * must be overridden for every request in this suite to go through the mock.
 */

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retriedAfterRefresh?: boolean;
}

function mockResponse(config: InternalAxiosRequestConfig, data: unknown) {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function mockError(config: InternalAxiosRequestConfig, status: number) {
  const response = { data: {}, status, statusText: '', headers: {}, config };
  return new AxiosError('Request failed', String(status), config, undefined, response as never);
}

describe('httpClient 401-refresh interceptor', () => {
  let refreshCallCount: number;
  let refreshShouldFail: boolean;
  let unsubscribeAuthExpired: (() => void) | undefined;
  let authExpiredCallCount: number;

  beforeEach(() => {
    refreshCallCount = 0;
    refreshShouldFail = false;
    authExpiredCallCount = 0;
    setAccessToken('initial-token');

    const adapter = vi.fn(async (config: RetryableConfig) => {
      const url = config.url ?? '';
      if (url.includes('/auth/refresh')) {
        refreshCallCount += 1;
        if (refreshShouldFail) {
          throw mockError(config, 401);
        }
        return mockResponse(config, { accessToken: `refreshed-${refreshCallCount}` });
      }

      // Any other ("protected resource") endpoint: 401 the first time, then
      // succeed once the interceptor has retried with a refreshed token.
      if (!config._retriedAfterRefresh) {
        throw mockError(config, 401);
      }
      return mockResponse(config, { ok: true, url });
    });

    apiClient.defaults.adapter = adapter;
    axios.defaults.adapter = adapter;

    unsubscribeAuthExpired = onAuthExpired(() => {
      authExpiredCallCount += 1;
    });
  });

  afterEach(() => {
    unsubscribeAuthExpired?.();
    setAccessToken(null);
  });

  it('triggers exactly one /auth/refresh call even when multiple requests 401 concurrently (dedup)', async () => {
    const [a, b] = await Promise.all([apiClient.get('/resource-a'), apiClient.get('/resource-b')]);

    expect(refreshCallCount).toBe(1);
    expect(a.data).toEqual({ ok: true, url: '/resource-a' });
    expect(b.data).toEqual({ ok: true, url: '/resource-b' });
  });

  it('a successful refresh retries the original request with the new token', async () => {
    const response = await apiClient.get('/resource-a');

    expect(refreshCallCount).toBe(1);
    expect(response.data).toEqual({ ok: true, url: '/resource-a' });
    expect(getAccessToken()).toBe('refreshed-1');
  });

  it('a failed refresh rejects the original request and notifies onAuthExpired (logout)', async () => {
    refreshShouldFail = true;

    await expect(apiClient.get('/resource-a')).rejects.toBeInstanceOf(AxiosError);

    expect(refreshCallCount).toBe(1);
    expect(authExpiredCallCount).toBe(1);
    expect(getAccessToken()).toBeNull();
  });

  it('never retries /auth/login, /auth/refresh or /auth/register themselves on 401', async () => {
    // A 401 straight from /auth/refresh must surface immediately, not loop
    // back into another refresh attempt.
    refreshShouldFail = true;

    await expect(
      axios.post('/auth/refresh', {}, { baseURL: '', withCredentials: true }),
    ).rejects.toBeInstanceOf(AxiosError);

    // Only the one direct call — no interceptor-triggered extra attempt.
    expect(refreshCallCount).toBe(1);
  });

  it('only retries a request once (a second 401 after retry is not retried again)', async () => {
    // Force the "protected resource" branch to keep 401ing even after a
    // retry, by making refresh succeed but the resource adapter branch
    // ignore the retried flag.
    const alwaysUnauthorized = vi.fn(async (config: InternalAxiosRequestConfig) => {
      const url = config.url ?? '';
      if (url.includes('/auth/refresh')) {
        refreshCallCount += 1;
        return mockResponse(config, { accessToken: 'refreshed-again' });
      }
      throw mockError(config, 401);
    });
    apiClient.defaults.adapter = alwaysUnauthorized;
    axios.defaults.adapter = alwaysUnauthorized;

    await expect(apiClient.get('/resource-a')).rejects.toBeInstanceOf(AxiosError);
    expect(refreshCallCount).toBe(1);
  });
});
