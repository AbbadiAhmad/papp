import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ModuleManifest, parseModuleManifest } from '@papp/shared-types';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { ManifestValidationError, ModuleRegistryService } from '../../../src/core/module-registry/module-registry.service';

/**
 * Tier 1 unit tests for the module install/upgrade/uninstall lifecycle
 * (docs/MODULE_SPEC.md §4/§5, BUILD_PLAN.md risk #4). Prisma,
 * MigrationRunnerService and I18nService are all hand-rolled jest.fn()
 * mocks — no DB, no containers.
 *
 * `manifest.json` files ARE read from real disk (via
 * ModuleRegistryService's own `readFileSync`/`existsSync`, which are not
 * injected and so can't be mocked through the constructor) — but these are
 * small, checked-in, static JSON fixtures under test/fixtures/modules/, the
 * same kind of "read a fixture off disk" the existing
 * migration-runner.integration-spec.ts already does; nothing here talks to
 * a database or a container. `MODULES_DIR` is pointed at that fixtures
 * directory for the duration of this suite, so `resolveModulesDir()` never
 * falls back to its real `__dirname`-relative default (see
 * apps/api/src/core/module-registry/modules-dir.ts) or the repo's real
 * (nonexistent) `modules/` directory.
 *
 * The real migration runner and the real `pg`-Client-based down-migration
 * path are never exercised: `migrationRunner.applyDirectory` is a plain
 * jest.fn(), and `runDownMigrationsIfPresent` (private, would open a real
 * `pg.Client`) is stubbed via `jest.spyOn` wherever uninstall(dropData=true)
 * is exercised — per the task's own "(mock it, assert it's invoked)".
 */

const testDir = dirname(fileURLToPath(import.meta.url));
const FIXTURES_MODULES_DIR = join(testDir, '..', '..', 'fixtures', 'modules');

interface MockPrisma {
  moduleRegistryEntry: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
  };
  permission: { createMany: jest.Mock; findMany: jest.Mock; deleteMany: jest.Mock };
  role: { findUnique: jest.Mock };
  rolePermission: { upsert: jest.Mock };
  systemSetting: { upsert: jest.Mock };
  moduleMenuEntry: { deleteMany: jest.Mock; createMany: jest.Mock };
  moduleMigration: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
}

interface MockMigrationRunner {
  applyDirectory: jest.Mock;
}

interface MockI18n {
  rebuild: jest.Mock;
}

/**
 * `$transaction` is used BOTH as a callback (`install`/`upgrade`, passed a
 * `tx`) and as an array of already-invoked promises (`uninstall`). This
 * single mock handles both call shapes; the callback form is handed the
 * SAME mock object as top-level `prisma` (not a separate `tx` double), so
 * assertions can reference `prisma.permission.createMany` etc. regardless
 * of whether the real code reached it via `tx` or `this.prisma`.
 */
function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    moduleRegistryEntry: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    permission: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    role: { findUnique: jest.fn().mockResolvedValue(null) },
    rolePermission: { upsert: jest.fn().mockResolvedValue({}) },
    systemSetting: { upsert: jest.fn().mockResolvedValue({}) },
    moduleMenuEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    moduleMigration: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockPrisma) => Promise<unknown>)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

/**
 * A schema-VALID raw manifest object, shaped exactly like
 * test/fixtures/modules/valid_module/manifest.json, for tests that exercise
 * `validateAgainstPlatform`/`applyDefaultRolePermissions` directly (private
 * methods, called via a narrow bracket-notation cast — MODULE_SPEC.md §4
 * step 2's cross-platform checks are the thing under test here, not Zod's
 * own self-consistency rules, which have their own coverage via the
 * `invalid_schema_module` fixture above). Overrides replace whole top-level
 * keys, so a caller passing e.g. `{ locales: {...} }` must supply the full
 * nested object.
 */
function buildRawManifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    key: 'test_module',
    name: 'Test Module',
    version: '1.0.0',
    compatibleAppVersion: '>=0.1.0',
    dependsOn: [],
    description: 'inline fixture manifest for validateAgainstPlatform tests',
    migrations: { dir: 'migrations' },
    locales: { supported: ['ar', 'en'], dir: 'locales' },
    permissions: [],
    defaultRolePermissions: {},
    roleAccessPolicy: 'grantable',
    roleAccessLocked: {},
    settings: [],
    routes: [],
    menu: [],
    frontend: { basePath: '/test_module', entry: 'index.tsx', landingPage: '/test_module' },
    backend: { entry: 'index.ts', apiPrefix: '/test_module' },
    lifecycle: { onInstall: null, onUpgrade: null, onUninstall: null },
    ...overrides,
  };
}

function buildManifest(overrides: Record<string, unknown> = {}): ModuleManifest {
  const parsed = parseModuleManifest(buildRawManifest(overrides));
  if (!parsed.success) {
    throw new Error(`buildManifest: fixture failed schema validation: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.manifest;
}

describe('ModuleRegistryService', () => {
  let prisma: MockPrisma;
  let migrationRunner: MockMigrationRunner;
  let i18n: MockI18n;
  let service: ModuleRegistryService;
  const originalModulesDir = process.env.MODULES_DIR;

  beforeEach(() => {
    process.env.MODULES_DIR = FIXTURES_MODULES_DIR;
    prisma = createMockPrisma();
    migrationRunner = { applyDirectory: jest.fn().mockResolvedValue(undefined) };
    i18n = { rebuild: jest.fn() };
    service = new ModuleRegistryService(prisma as never, migrationRunner as never, i18n as never);
  });

  afterEach(() => {
    if (originalModulesDir === undefined) delete process.env.MODULES_DIR;
    else process.env.MODULES_DIR = originalModulesDir;
    jest.restoreAllMocks();
  });

  describe('listAvailableToInstall()', () => {
    it('lists every module directory with a valid manifest.json that is NOT currently active in the registry', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([]);

      const result = await service.listAvailableToInstall();
      const keys = result.map((m) => m.key);

      // valid_module/depends_module/empty_down_module all ship real,
      // schema-valid manifests — included. malformed_json_module (invalid
      // JSON), invalid_schema_module (fails Zod validation), and
      // fake_module (no manifest.json at all) are all real fixture
      // directories that must be silently SKIPPED, not thrown.
      expect(keys).toContain('valid_module');
      expect(keys).not.toContain('malformed_json_module');
      expect(keys).not.toContain('invalid_schema_module');
      expect(keys).not.toContain('fake_module');
    });

    it('excludes a module whose registry row is already installed/installing/upgrading', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([{ key: 'valid_module' }]);

      const result = await service.listAvailableToInstall();

      expect(result.map((m) => m.key)).not.toContain('valid_module');
      expect(prisma.moduleRegistryEntry.findMany).toHaveBeenCalledWith({
        where: { status: { in: ['installed', 'installing', 'upgrading'] } },
        select: { key: true },
      });
    });

    it('reports the manifest key/name/description/version for each candidate', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([]);

      const result = await service.listAvailableToInstall();
      const validModule = result.find((m) => m.key === 'valid_module');

      expect(validModule).toEqual({
        key: 'valid_module',
        name: 'Valid Module',
        description: 'Fixture module for ModuleRegistryService unit tests',
        version: '1.0.0',
      });
    });

    it('returns an empty array (never throws) when the modules directory does not exist at all', async () => {
      process.env.MODULES_DIR = join(FIXTURES_MODULES_DIR, 'does-not-exist');
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([]);

      await expect(service.listAvailableToInstall()).resolves.toEqual([]);
    });
  });

  describe('install()', () => {
    it('happy path: registers permissions, grants defaults, seeds settings and menu, in that order, ending "installed"', async () => {
      // First call ("already registered?") must be null; every later call —
      // just findOrThrow()'s final re-read — resolves the now-installed row.
      prisma.moduleRegistryEntry.findUnique.mockResolvedValueOnce(null).mockResolvedValue({
        key: 'valid_module',
        status: 'installed',
        version: '1.0.0',
        installedAt: new Date(),
        updatedAt: new Date(),
        manifestSnapshot: {},
      });
      prisma.permission.findMany.mockResolvedValue([{ id: 'perm-1', code: 'valid_module.items.view' }]);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-admin', code: 'admin' });

      const callOrder: string[] = [];
      prisma.permission.createMany.mockImplementation(async () => {
        callOrder.push('registerPermissions');
        return { count: 1 };
      });
      prisma.permission.findMany.mockImplementation(async () => {
        callOrder.push('applyDefaultRolePermissions');
        return [{ id: 'perm-1', code: 'valid_module.items.view' }];
      });
      prisma.systemSetting.upsert.mockImplementation(async () => {
        callOrder.push('seedSettings');
        return {};
      });
      prisma.moduleMenuEntry.deleteMany.mockImplementation(async () => {
        callOrder.push('replaceMenuEntries');
        return { count: 0 };
      });

      const result = await service.install('valid_module', 'admin-user-1');

      expect(callOrder).toEqual([
        'registerPermissions',
        'applyDefaultRolePermissions',
        'seedSettings',
        'replaceMenuEntries',
      ]);

      expect(migrationRunner.applyDirectory).toHaveBeenCalledWith(
        expect.stringContaining(join('valid_module', 'migrations')),
        'valid_module',
      );
      expect(prisma.permission.createMany).toHaveBeenCalledWith({
        data: [{ code: 'valid_module.items.view', moduleKey: 'valid_module', category: 'items', descriptionI18nKey: 'valid_module.perm.items.view' }],
        skipDuplicates: true,
      });
      expect(prisma.rolePermission.upsert).toHaveBeenCalledWith({
        where: { roleId_permissionId: { roleId: 'role-admin', permissionId: 'perm-1' } },
        update: {},
        create: { roleId: 'role-admin', permissionId: 'perm-1', grantedBy: 'admin-user-1' },
      });
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'valid_module.some_setting' },
        update: {},
        create: { key: 'valid_module.some_setting', value: true },
      });
      expect(prisma.moduleMenuEntry.deleteMany).toHaveBeenCalledWith({ where: { moduleKey: 'valid_module' } });
      expect(prisma.moduleMenuEntry.createMany).toHaveBeenCalledTimes(1);

      // Final status write happens inside the transaction, ending "installed".
      const finalUpdateCall = prisma.moduleRegistryEntry.update.mock.calls.find(
        (call) => (call[0] as { data: { status: string } }).data.status === 'installed',
      );
      expect(finalUpdateCall).toBeDefined();
      expect(i18n.rebuild).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('installed');
    });

    it('rejects with ConflictException when the module is already active, and writes nothing', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'valid_module', status: 'installed' });

      await expect(service.install('valid_module')).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.moduleRegistryEntry.upsert).not.toHaveBeenCalled();
      expect(migrationRunner.applyDirectory).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('marks the module "failed" and never runs migrations when manifest.json fails schema validation', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue(null);

      await expect(service.install('invalid_schema_module')).rejects.toBeInstanceOf(BadRequestException);

      expect(migrationRunner.applyDirectory).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.moduleRegistryEntry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'invalid_schema_module' },
          update: expect.objectContaining({ status: 'failed' }),
          create: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });

    it('marks the module "failed" and never runs migrations on a cross-validation failure (unmet dependsOn)', async () => {
      // depends_module's manifest declares dependsOn: ["missing_dep"], which
      // passes the SCHEMA (a plain string array) but fails
      // validateAgainstPlatform because no such module is installed —
      // findUnique resolving null/undefined for BOTH "is this module already
      // registered" and "is the dependency installed" is exactly what
      // forces that: the module itself isn't registered (fine, install can
      // proceed to validation) and its dependency isn't either (not fine).
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue(null);

      await expect(service.install('depends_module')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.install('depends_module')).rejects.toMatchObject({
        response: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ path: 'dependsOn', message: expect.stringContaining('missing_dep') }),
          ]),
        }),
      });

      expect(migrationRunner.applyDirectory).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.moduleRegistryEntry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });

    it('throws NotFoundException when no manifest.json exists on disk for the key, without touching the DB', async () => {
      await expect(service.install('totally_missing_module')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.moduleRegistryEntry.findUnique).not.toHaveBeenCalled();
      expect(prisma.moduleRegistryEntry.upsert).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when manifest.json is not valid JSON', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue(null);

      await expect(service.install('malformed_json_module')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.install('malformed_json_module')).rejects.toThrow(/not valid JSON/);
    });

    it('marks the module "failed" and rejects with InternalServerErrorException when migrations throw', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue(null);
      migrationRunner.applyDirectory.mockRejectedValue(new Error('disk full'));

      await expect(service.install('valid_module')).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(service.install('valid_module')).rejects.toThrow(/disk full/);

      expect(prisma.moduleRegistryEntry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'failed' }),
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('upgrade()', () => {
    beforeEach(() => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'valid_module', status: 'installed' });
      prisma.permission.findMany.mockResolvedValue([{ id: 'perm-1', code: 'valid_module.items.view' }]);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-admin', code: 'admin' });
    });

    it('NEVER calls applyDefaultRolePermissions — new permissions get zero default grants (BUILD_PLAN risk #4)', async () => {
      const spy = jest.spyOn(
        service as unknown as { applyDefaultRolePermissions: (...args: unknown[]) => Promise<void> },
        'applyDefaultRolePermissions',
      );

      await service.upgrade('valid_module', 'admin-user-1');

      expect(spy).not.toHaveBeenCalled();
      expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
    });

    it('registers only new permission codes (skipDuplicates) and seeds only new setting keys (no-op update)', async () => {
      await service.upgrade('valid_module');

      expect(prisma.permission.createMany).toHaveBeenCalledWith({
        data: [{ code: 'valid_module.items.view', moduleKey: 'valid_module', category: 'items', descriptionI18nKey: 'valid_module.perm.items.view' }],
        skipDuplicates: true,
      });
      // The no-op `update: {}` is what makes an existing key untouched and a
      // new key seeded — same upsert call shape either way (seedSettings is
      // shared between install/upgrade by design).
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'valid_module.some_setting' },
        update: {},
        create: { key: 'valid_module.some_setting', value: true },
      });
    });

    it('ends in status "installed" and rebuilds i18n', async () => {
      const result = await service.upgrade('valid_module');
      expect(result.status).toBe('installed');
      expect(i18n.rebuild).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when the module is not registered at all', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue(null);
      await expect(service.upgrade('valid_module')).rejects.toBeInstanceOf(NotFoundException);
      expect(migrationRunner.applyDirectory).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the current status is not upgradable', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'valid_module', status: 'installing' });
      await expect(service.upgrade('valid_module')).rejects.toBeInstanceOf(ConflictException);
      expect(migrationRunner.applyDirectory).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no manifest.json exists on disk for the key', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'ghost_module', status: 'installed' });
      await expect(service.upgrade('ghost_module')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('marks the module "failed" and rejects when manifest.json fails schema validation', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'invalid_schema_module', status: 'installed' });

      await expect(service.upgrade('invalid_schema_module')).rejects.toBeInstanceOf(BadRequestException);

      expect(migrationRunner.applyDirectory).not.toHaveBeenCalled();
      expect(prisma.moduleRegistryEntry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'failed' }) }),
      );
    });

    it('marks the module "failed" and rejects on a cross-validation failure (unmet dependsOn)', async () => {
      prisma.moduleRegistryEntry.findUnique.mockImplementation(async (args: unknown) => {
        const key = (args as { where: { key: string } }).where.key;
        if (key === 'depends_module') return { key: 'depends_module', status: 'installed' };
        return null;
      });

      await expect(service.upgrade('depends_module')).rejects.toBeInstanceOf(BadRequestException);

      expect(migrationRunner.applyDirectory).not.toHaveBeenCalled();
      expect(prisma.moduleRegistryEntry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'failed' }) }),
      );
    });

    it('marks the module "failed" and rejects with InternalServerErrorException when migrations throw', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'valid_module', status: 'installed' });
      migrationRunner.applyDirectory.mockRejectedValue(new Error('disk full'));

      await expect(service.upgrade('valid_module')).rejects.toBeInstanceOf(InternalServerErrorException);

      expect(prisma.moduleRegistryEntry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'failed' }) }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('uninstall()', () => {
    it('without dropData: deletes permissions/menu but never touches system_settings, and skips the down-migration path', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'valid_module', status: 'installed' });
      prisma.moduleRegistryEntry.update.mockResolvedValue({ key: 'valid_module', status: 'disabled' });
      const downMigrationsSpy = jest
        .spyOn(service as unknown as { runDownMigrationsIfPresent: (key: string) => Promise<void> }, 'runDownMigrationsIfPresent')
        .mockResolvedValue(undefined);

      await service.uninstall('valid_module', false);

      expect(prisma.moduleMenuEntry.deleteMany).toHaveBeenCalledWith({ where: { moduleKey: 'valid_module' } });
      expect(prisma.permission.deleteMany).toHaveBeenCalledWith({ where: { moduleKey: 'valid_module' } });
      expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
      expect(downMigrationsSpy).not.toHaveBeenCalled();
      expect(i18n.rebuild).toHaveBeenCalledTimes(1);
    });

    it('with dropData: attempts the down-migration path (mocked) exactly once, for the right key', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'valid_module', status: 'installed' });
      prisma.moduleRegistryEntry.update.mockResolvedValue({ key: 'valid_module', status: 'disabled' });
      const downMigrationsSpy = jest
        .spyOn(service as unknown as { runDownMigrationsIfPresent: (key: string) => Promise<void> }, 'runDownMigrationsIfPresent')
        .mockResolvedValue(undefined);

      await service.uninstall('valid_module', true);

      expect(downMigrationsSpy).toHaveBeenCalledTimes(1);
      expect(downMigrationsSpy).toHaveBeenCalledWith('valid_module');
    });

    it('throws ForbiddenException for the core pseudo-module, without touching the DB', async () => {
      await expect(service.uninstall('core', false)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moduleRegistryEntry.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the module is not registered', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue(null);
      await expect(service.uninstall('valid_module', false)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the current status cannot be uninstalled', async () => {
      prisma.moduleRegistryEntry.findUnique.mockResolvedValue({ key: 'valid_module', status: 'installing' });
      await expect(service.uninstall('valid_module', false)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('list()', () => {
    it('maps every registry row through the public presenter, ordered by key', async () => {
      const row = {
        key: 'valid_module',
        version: '1.0.0',
        status: 'installed',
        installedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        manifestSnapshot: { some: 'snapshot' },
      };
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([row]);

      const result = await service.list();

      expect(prisma.moduleRegistryEntry.findMany).toHaveBeenCalledWith({ orderBy: { key: 'asc' } });
      expect(result).toEqual([
        {
          key: 'valid_module',
          version: '1.0.0',
          status: 'installed',
          installedAt: row.installedAt,
          updatedAt: row.updatedAt,
          manifestSnapshot: { some: 'snapshot' },
        },
      ]);
    });
  });

  describe('listFrontendManifests()', () => {
    it('queries only installed, non-core modules and projects just the frontend-shell slice', async () => {
      const manifest = {
        frontend: { basePath: '/site', entry: 'frontend/routes.tsx', landingPage: '/site/admin/pages' },
        routes: [{ pattern: '/site', access: 'public', component: 'frontend/pages/PublicSitePage.tsx' }],
        menu: [{ id: 'website.pages', labelKey: 'website.menu.pages', parentId: null, order: 1, route: '/site/admin/pages', requiredPermission: 'website.pages.view' }],
      };
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([
        { key: 'website', status: 'installed', manifestSnapshot: manifest },
      ]);

      const result = await service.listFrontendManifests();

      expect(prisma.moduleRegistryEntry.findMany).toHaveBeenCalledWith({
        where: { status: 'installed', key: { not: 'core' } },
        orderBy: { key: 'asc' },
      });
      expect(result).toEqual([
        { key: 'website', basePath: '/site', routes: manifest.routes, menu: manifest.menu },
      ]);
    });

    it('never exposes version/status/permissions/settings/backend manifest internals', async () => {
      const manifest = {
        frontend: { basePath: '/site', entry: 'frontend/routes.tsx', landingPage: '/site' },
        routes: [],
        menu: [],
        backend: { entry: 'backend/website.module.js', apiPrefix: '/api/website' },
        permissions: [{ code: 'website.pages.view', category: 'website', descriptionKey: 'website.perm.pages.view' }],
        settings: [{ key: 'website.site_config', type: 'json', default: {}, labelKey: 'x', requiredPermission: 'website.settings.update' }],
      };
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([
        { key: 'website', status: 'installed', manifestSnapshot: manifest },
      ]);

      const [result] = await service.listFrontendManifests();

      expect(result).not.toHaveProperty('backend');
      expect(result).not.toHaveProperty('permissions');
      expect(result).not.toHaveProperty('settings');
      expect(result).not.toHaveProperty('version');
      expect(result).not.toHaveProperty('status');
    });

    it('drops a row whose stored manifestSnapshot is not a real manifest object (defensive only)', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([
        { key: 'broken', status: 'installed', manifestSnapshot: null },
        { key: 'also_broken', status: 'installed', manifestSnapshot: 'not-an-object' },
      ]);

      const result = await service.listFrontendManifests();

      expect(result).toEqual([]);
    });
  });

  describe('triggerOrchestratedRestart()', () => {
    it('logs the D15 rationale and calls process.exit(0)', () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      service.triggerOrchestratedRestart('valid_module', 'install');

      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  /**
   * Direct calls into the private cross-validation method — narrower and
   * more targeted than driving every branch through install()/upgrade(),
   * which already cover the "manifest schema itself is fine but
   * validateAgainstPlatform rejects it" outcome for the dependsOn case.
   * These cover the sibling branches: key mismatch, missing 'ar' locale,
   * an unsatisfied compatibleAppVersion range, and both flavors of
   * basePath/apiPrefix collision against an already-installed module.
   */
  describe('validateAgainstPlatform() (direct)', () => {
    function validate(key: string, manifest: ModuleManifest): Promise<ManifestValidationError[]> {
      return (
        service as unknown as {
          validateAgainstPlatform: (key: string, manifest: ModuleManifest) => Promise<ManifestValidationError[]>;
        }
      ).validateAgainstPlatform(key, manifest);
    }

    it('flags a manifest key that does not match the requested install key', async () => {
      const manifest = buildManifest(); // key: 'test_module'
      const issues = await validate('some_other_key', manifest);
      expect(issues).toContainEqual(expect.objectContaining({ path: 'key' }));
    });

    it('flags a manifest that does not ship the platform default language (ar)', async () => {
      const manifest = buildManifest({ locales: { supported: ['en'], dir: 'locales' } });
      const issues = await validate('test_module', manifest);
      expect(issues).toContainEqual(expect.objectContaining({ path: 'locales.supported' }));
    });

    it('flags a compatibleAppVersion range the running platform version does not satisfy', async () => {
      const manifest = buildManifest({ compatibleAppVersion: '>=99.0.0' });
      const issues = await validate('test_module', manifest);
      expect(issues).toContainEqual(expect.objectContaining({ path: 'compatibleAppVersion' }));
    });

    it('flags a frontend.basePath and backend.apiPrefix that collide with an already-installed module', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([
        {
          key: 'some_other_module',
          status: 'installed',
          manifestSnapshot: {
            frontend: { basePath: '/test_module' },
            backend: { apiPrefix: '/test_module' },
          },
        },
      ]);
      const manifest = buildManifest(); // frontend.basePath = backend.apiPrefix = '/test_module'

      const issues = await validate('test_module', manifest);

      expect(issues).toContainEqual(expect.objectContaining({ path: 'frontend.basePath' }));
      expect(issues).toContainEqual(expect.objectContaining({ path: 'backend.apiPrefix' }));
    });

    it('does not collide with itself or with core when re-validating an already-installed module', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([
        { key: 'test_module', status: 'installed', manifestSnapshot: null },
        { key: 'core', status: 'installed', manifestSnapshot: null },
      ]);
      const manifest = buildManifest();

      const issues = await validate('test_module', manifest);

      expect(issues.find((i) => i.path === 'frontend.basePath')).toBeUndefined();
      expect(issues.find((i) => i.path === 'backend.apiPrefix')).toBeUndefined();
    });
  });

  describe('applyDefaultRolePermissions() (direct)', () => {
    it('warns and skips a role code that defaultRolePermissions references but that does not exist', async () => {
      const manifest = buildManifest({
        permissions: [{ code: 'test_module.items.view', category: 'items', descriptionKey: 'test_module.perm.items.view' }],
        defaultRolePermissions: { ghost_role: ['test_module.items.view'] },
      });
      prisma.permission.findMany.mockResolvedValue([{ id: 'perm-1', code: 'test_module.items.view' }]);
      prisma.role.findUnique.mockResolvedValue(null);

      await (
        service as unknown as {
          applyDefaultRolePermissions: (tx: unknown, manifest: ModuleManifest, grantedBy?: string) => Promise<void>;
        }
      ).applyDefaultRolePermissions(prisma, manifest, 'admin-1');

      expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { code: 'ghost_role' } });
      expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
    });
  });

  /**
   * Direct calls into the private down-migration runner — the existing
   * uninstall() tests above mock this method out entirely (per this suite's
   * own docblock) to keep uninstall()'s own tests focused on the
   * lifecycle/status transitions; these cover the runner's own body,
   * including the real `pg` Client usage (spied on its prototype so nothing
   * touches a real database).
   */
  describe('runDownMigrationsIfPresent() (direct)', () => {
    function runDownMigrations(key: string): Promise<void> {
      return (service as unknown as { runDownMigrationsIfPresent: (key: string) => Promise<void> }).runDownMigrationsIfPresent(
        key,
      );
    }

    it('warns and returns without touching module_migrations when migrations/down does not exist', async () => {
      // depends_module's fixture directory has no migrations/down/ subdirectory at all.
      await runDownMigrations('depends_module');
      expect(prisma.moduleMigration.deleteMany).not.toHaveBeenCalled();
    });

    it('warns and returns without touching module_migrations when migrations/down has no .sql files', async () => {
      await runDownMigrations('empty_down_module');
      expect(prisma.moduleMigration.deleteMany).not.toHaveBeenCalled();
    });

    it('runs every down migration in reverse filename order via a pg Client, then clears module_migrations rows', async () => {
      const connectSpy = jest.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined as never);
      const queriedSql: string[] = [];
      const querySpy = jest
        .spyOn(Client.prototype, 'query')
        .mockImplementation((async (sql: unknown) => {
          queriedSql.push(String(sql).trim());
          return {} as never;
        }) as never);
      const endSpy = jest.spyOn(Client.prototype, 'end').mockResolvedValue(undefined as never);

      await runDownMigrations('valid_module');

      expect(connectSpy).toHaveBeenCalledTimes(1);
      // 002_drop.sql sorts before 001_seed.sql in reverse filename order.
      expect(queriedSql).toEqual(['select 1;', 'select 1;']);
      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(endSpy).toHaveBeenCalledTimes(1);
      expect(prisma.moduleMigration.deleteMany).toHaveBeenCalledWith({ where: { moduleKey: 'valid_module' } });
    });

    it('still closes the client and rethrows when a down migration query fails', async () => {
      jest.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined as never);
      jest.spyOn(Client.prototype, 'query').mockRejectedValue(new Error('bad sql') as never);
      const endSpy = jest.spyOn(Client.prototype, 'end').mockResolvedValue(undefined as never);

      await expect(runDownMigrations('valid_module')).rejects.toThrow(/bad sql/);

      expect(endSpy).toHaveBeenCalledTimes(1);
      expect(prisma.moduleMigration.deleteMany).not.toHaveBeenCalled();
    });
  });
});
