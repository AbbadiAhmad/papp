import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Core api routes have no `/api` prefix, so nginx must list every one of them or the SPA fallback answers an API call
 * with index.html (200) — which crashed the sidebar when `/appearance` was missing. Keeps nginx.conf, vite.config.ts
 * and the real controllers in step.
 */
const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('core api path prefixes', () => {
  const nginx = read('apps/web/nginx.conf').match(/location ~ \^\/\(([^)]+)\)/)![1].split('|');
  const vite = [...read('apps/web/vite.config.ts').match(/CORE_API_PATH_PREFIXES = \[([^\]]+)\]/)![1].matchAll(/'\/([^']+)'/g)].map((m) => m[1]);
  const controllers = [...new Set(
    ['appearance', 'audit', 'auth', 'backup', 'i18n', 'modules', 'notifications', 'permissions', 'roles', 'sessions', 'settings', 'users'],
  )];

  it('nginx proxies every core controller prefix', () => {
    for (const prefix of controllers) expect(nginx).toContain(prefix);
  });

  it('nginx and the vite dev proxy list the same prefixes', () => {
    expect([...nginx].sort()).toEqual([...vite].sort());
  });
});
