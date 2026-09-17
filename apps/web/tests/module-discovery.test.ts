import { describe, expect, it } from 'vitest';
import { getAllDiscoveredModuleRoutes } from '../src/shared/modules/discovery';

/**
 * Guards the platform half of root DECISIONS.md D78: `discovery.ts`'s
 * `import.meta.glob('../../../../../modules/*\/frontend/routes.tsx', ...)`
 * must find every module's routes file GENERICALLY, with no module name
 * hardcoded in the glob pattern itself. This test references real module
 * keys only to assert the mechanism actually works end to end — it does
 * NOT add a new hardcoded dependency to platform code (this is a test, not
 * `apps/web/src/**`, which `scripts/lint-no-module-specific-platform-code.ts`
 * scans instead).
 */
describe('shared/modules/discovery: build-time module route discovery', () => {
  it('discovers every real module physically present under modules/*/frontend/routes.tsx', () => {
    const discovered = getAllDiscoveredModuleRoutes();

    for (const key of ['library_catalog', 'library_circulation', 'survey', 'template', 'website']) {
      expect(discovered.has(key)).toBe(true);
    }
  });

  it('every discovered module exports the FIXED authenticatedRoutes/publicRoutes contract, never a per-module name', () => {
    const discovered = getAllDiscoveredModuleRoutes();

    for (const [key, mod] of discovered) {
      const hasAuthenticated = Array.isArray(mod.authenticatedRoutes);
      const hasPublic = Array.isArray(mod.publicRoutes);
      expect(hasAuthenticated || hasPublic, `${key} exports neither authenticatedRoutes nor publicRoutes`).toBe(true);
    }
  });

  it('website exports its real /site and /site/:slug public routes', () => {
    const discovered = getAllDiscoveredModuleRoutes();
    const website = discovered.get('website');

    expect(website?.publicRoutes?.map((r) => r.path)).toEqual(expect.arrayContaining(['/site', '/site/:slug']));
  });

  it('is a pure, generic mechanism: no module name appears in discovery.ts itself', async () => {
    // Reads its own source (not an import) so the check covers the actual
    // shipped mechanism, not a hand-copied string.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { join, dirname } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '..', 'src', 'shared', 'modules', 'discovery.ts'), 'utf8');
    for (const key of ['library_catalog', 'library_circulation', 'survey', 'template', 'website']) {
      expect(source).not.toContain(key);
    }
  });
});
