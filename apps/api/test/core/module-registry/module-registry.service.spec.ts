import { BadRequestException, ConflictException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleRegistryService } from '../../../src/core/module-registry/module-registry.service';

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
  });
});
