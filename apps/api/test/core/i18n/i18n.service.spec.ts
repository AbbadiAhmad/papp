import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LANGUAGE, I18nService } from '../../../src/core/i18n/i18n.service';

/**
 * ESM test-runner gotcha specific to this file (see jest.base.config.ts's
 * own doc-comment for the sibling sanitize-html one): I18nService reads its
 * CORE locale directory via a bare `join(__dirname, 'locales')` — correct
 * in the real app, where `nest build`'s CommonJS output gives every module
 * a real `__dirname`, but this test layer compiles/runs source as genuine
 * ESM (`tsconfig.test.esm.json`, `useESM: true`), where `__dirname` is not
 * a global at all and referencing it throws `ReferenceError: __dirname is
 * not defined`. Assigning it onto `globalThis` before calling any
 * I18nService method works around this without touching src/**: unqualified
 * identifier lookup in a module still falls through to the global object,
 * so `join(__dirname, ...)` inside i18n.service.ts resolves to whatever
 * this file sets here. This is a TEST-ONLY workaround for a test-transform
 * artifact, not a production bug — flagged in the phase report for whoever
 * owns jest.base.config.ts / the module's `__dirname` usage next.
 */
const CORE_I18N_SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'core', 'i18n');
const FIXTURES_MODULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'modules');

interface MockPrisma {
  moduleRegistryEntry: { findMany: jest.Mock };
}

function createMockPrisma(): MockPrisma {
  return { moduleRegistryEntry: { findMany: jest.fn().mockResolvedValue([]) } };
}

/** The fake_module fixture's manifest snapshot, as ModuleRegistryService would have stored it. */
const FAKE_MODULE_ROW = {
  key: 'fake_module',
  manifestSnapshot: { locales: { dir: 'locales' } },
};

describe('I18nService', () => {
  let prisma: MockPrisma;
  let service: I18nService;
  const originalModulesDir = process.env.MODULES_DIR;
  const originalDirname = (globalThis as unknown as { __dirname?: string }).__dirname;

  beforeEach(() => {
    process.env.MODULES_DIR = FIXTURES_MODULES_DIR;
    (globalThis as unknown as { __dirname: string }).__dirname = CORE_I18N_SRC_DIR;
    prisma = createMockPrisma();
    service = new I18nService(prisma as never);
  });

  afterEach(() => {
    if (originalModulesDir === undefined) delete process.env.MODULES_DIR;
    else process.env.MODULES_DIR = originalModulesDir;
    (globalThis as unknown as { __dirname?: string }).__dirname = originalDirname;
    jest.restoreAllMocks();
  });

  it('DEFAULT_LANGUAGE is "ar" (D19/D_A4 — the last-resort dictionary)', () => {
    expect(DEFAULT_LANGUAGE).toBe('ar');
  });

  it('merges core strings with an installed module\'s locale dict', async () => {
    prisma.moduleRegistryEntry.findMany.mockResolvedValue([FAKE_MODULE_ROW]);

    const bundle = await service.getBundle('ar');

    // A real core key (from apps/api/src/core/i18n/locales/ar.json).
    expect(bundle.messages['core.app.name']).toBeDefined();
    // The fake module's own keys, merged in.
    expect(bundle.messages['fake_module.common.title']).toBe('العنوان بالعربية');
    expect(bundle.messages['fake_module.only_in_ar']).toBe('فقط بالعربية');
    expect(bundle.lang).toBe('ar');
    expect(bundle.direction).toBe('rtl');
  });

  it('falls back to the "ar" value (not the literal key) for a key missing in the requested language', async () => {
    prisma.moduleRegistryEntry.findMany.mockResolvedValue([FAKE_MODULE_ROW]);

    const bundle = await service.getBundle('en');

    // "en" has its own translation for this key — it must win over "ar".
    expect(bundle.messages['fake_module.common.title']).toBe('Title in English');
    // "en" ships no translation at all for this key — falls back to the
    // Arabic string, never the bare dot-namespaced key itself.
    expect(bundle.messages['fake_module.only_in_ar']).toBe('فقط بالعربية');
    expect(bundle.messages['fake_module.only_in_ar']).not.toBe('fake_module.only_in_ar');
    expect(bundle.direction).toBe('ltr');
  });

  it('degrades an entirely unknown language to the full "ar" dictionary rather than an empty bundle', async () => {
    const bundle = await service.getBundle('fr');
    expect(bundle.messages['core.app.name']).toBeDefined();
    expect(bundle.direction).toBe('ltr'); // 'fr' isn't in the RTL set
  });

  it('builds dictionaries once and caches them — a second getBundle() does not re-query Prisma', async () => {
    await service.getBundle('ar');
    await service.getBundle('en');
    await service.availableLanguages();

    expect(prisma.moduleRegistryEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('rebuild() drops the cache so the next call reflects a newly-installed module', async () => {
    const before = await service.getBundle('ar');
    expect(before.messages['fake_module.common.title']).toBeUndefined();
    expect(prisma.moduleRegistryEntry.findMany).toHaveBeenCalledTimes(1);

    prisma.moduleRegistryEntry.findMany.mockResolvedValue([FAKE_MODULE_ROW]);
    service.rebuild();

    const after = await service.getBundle('ar');
    expect(after.messages['fake_module.common.title']).toBe('العنوان بالعربية');
    expect(prisma.moduleRegistryEntry.findMany).toHaveBeenCalledTimes(2);
  });
});
