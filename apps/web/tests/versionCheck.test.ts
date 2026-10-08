import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadIfNewVersion } from '../src/shared/versionCheck';

const reload = vi.fn();

function mockServerVersion(version: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => ({ version }) }));
}

describe('reloadIfNewVersion (D94)', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('__APP_VERSION__', 'v1');
    sessionStorage.clear();
    reload.mockClear();
    Object.defineProperty(window, 'location', { value: { reload }, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not reload when versions match', async () => {
    mockServerVersion('v1');
    expect(await reloadIfNewVersion()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once on a mismatch, not again for the same server version', async () => {
    mockServerVersion('v2');
    expect(await reloadIfNewVersion()).toBe(true);
    expect(await reloadIfNewVersion()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores failures and bad responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await reloadIfNewVersion()).toBe(false);
    mockServerVersion(undefined);
    expect(await reloadIfNewVersion()).toBe(false);
    mockServerVersion('v2', false);
    expect(await reloadIfNewVersion()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
