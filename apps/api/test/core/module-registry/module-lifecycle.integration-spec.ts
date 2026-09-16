import type { INestApplication } from '@nestjs/common';
import { InternalServerErrorException } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleRegistryService } from '../../../src/core/module-registry/module-registry.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';

const MODULE_KEY = 'itest_fixture';

/** Minimal but schema-valid manifest.json content, per packages/shared-types/src/module-manifest.ts. */
function manifestV1(): unknown {
  return {
    key: MODULE_KEY,
    name: 'Integration Test Fixture Module',
    version: '1.0.0',
    compatibleAppVersion: '>=0.1.0',
    dependsOn: [],
    description: 'Throwaway module fixture for Phase 9 ModuleRegistry lifecycle integration tests',
    migrations: { dir: 'migrations' },
    locales: { supported: ['ar', 'en'], dir: 'locales' },
    permissions: [{ code: 'itest_fixture.items.view', category: 'items', descriptionKey: 'itest_fixture.perm.items.view' }],
    defaultRolePermissions: { admin: ['itest_fixture.items.view'] },
    roleAccessPolicy: 'grantable',
    roleAccessLocked: {},
    settings: [],
    routes: [],
    menu: [
      {
        id: 'itest_fixture_root',
        labelKey: 'itest_fixture.menu.root',
        parentId: null,
        order: 1,
        route: '/itest_fixture',
        requiredPermission: 'itest_fixture.items.view',
      },
    ],
    frontend: { basePath: '/itest_fixture', entry: 'index.tsx', landingPage: '/itest_fixture' },
    backend: { entry: 'index.ts', apiPrefix: '/itest_fixture' },
    lifecycle: { onInstall: null, onUpgrade: null, onUninstall: null },
  };
}

/** v2: bumps version, adds a SECOND permission that upgrade() must NOT auto-grant to anyone. */
function manifestV2(): unknown {
  const v1 = manifestV1() as Record<string, unknown>;
  return {
    ...v1,
    version: '2.0.0',
    permissions: [
      ...(v1.permissions as unknown[]),
      { code: 'itest_fixture.items.edit', category: 'items', descriptionKey: 'itest_fixture.perm.items.edit' },
    ],
  };
}

/**
 * Tier 2: docs/BUILD_PLAN.md Phase 9 / docs/TESTING_STRATEGY.md §7 — the
 * install/upgrade/uninstall lifecycle against a REAL database and REAL
 * migration files on disk, which is exactly what Tier 1's mocked-fs/mocked-
 * Prisma `module-registry.service.spec.ts` cannot prove:
 *   - migrations genuinely execute (the table/column really exists after);
 *   - "first install only" grants really don't get silently re-applied over
 *     an admin's manual customization on upgrade (BUILD_PLAN.md risk #4);
 *   - a tampered already-applied migration file really fails a real
 *     checksum comparison read back from `module_migrations`;
 *   - uninstall --drop-data really runs the down migration and really drops
 *     the table.
 *
 * Uses a throwaway MODULES_DIR (mkdtemp), never the checked-in
 * `modules/` directory or `test/fixtures/modules/` — this spec's write
 * scope is *.integration-spec.ts files only.
 */
describe('ModuleRegistryService lifecycle (integration, real DB + real fixture module on disk)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let moduleRegistry: ModuleRegistryService;
  let modulesDir: string;
  let originalModulesDirEnv: string | undefined;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    moduleRegistry = app.get(ModuleRegistryService);

    modulesDir = mkdtempSync(join(tmpdir(), 'papp-module-lifecycle-'));
    const moduleDir = join(modulesDir, MODULE_KEY);
    mkdirSync(join(moduleDir, 'migrations', 'down'), { recursive: true });
    writeFileSync(join(moduleDir, 'manifest.json'), JSON.stringify(manifestV1(), null, 2));
    writeFileSync(
      join(moduleDir, 'migrations', '0001_create_table.sql'),
      'CREATE TABLE itest_fixture_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL);\n',
    );
    writeFileSync(join(moduleDir, 'migrations', 'down', '0001_drop_table.sql'), 'DROP TABLE IF EXISTS itest_fixture_items;\n');

    originalModulesDirEnv = process.env.MODULES_DIR;
    process.env.MODULES_DIR = modulesDir;
  }, 120_000);

  afterAll(async () => {
    if (originalModulesDirEnv === undefined) {
      delete process.env.MODULES_DIR;
    } else {
      process.env.MODULES_DIR = originalModulesDirEnv;
    }
    rmSync(modulesDir, { recursive: true, force: true });
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  async function tableExists(tableName: string): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('${tableName}') IS NOT NULL AS exists`,
    );
    return rows[0].exists;
  }

  async function columnExists(tableName: string, columnName: string): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM information_schema.columns WHERE table_name = '${tableName}' AND column_name = '${columnName}'`,
    );
    return Number(rows[0].count) > 0;
  }

  it('install() actually runs the migration file: the table exists, and the permission is granted to admin for real', async () => {
    const result = await moduleRegistry.install(MODULE_KEY, undefined);

    expect(result.status).toBe('installed');
    expect(result.version).toBe('1.0.0');
    expect(await tableExists('itest_fixture_items')).toBe(true);

    const migrationRow = await prisma.moduleMigration.findUnique({
      where: { moduleKey_filename: { moduleKey: MODULE_KEY, filename: '0001_create_table.sql' } },
    });
    expect(migrationRow).not.toBeNull();
    expect(migrationRow?.checksum).toHaveLength(64);

    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'itest_fixture.items.view' } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
    });
    expect(grant).not.toBeNull();
  });

  it('upgrade() applies only the NEW migration and does NOT re-apply a first-install grant an admin manually revoked', async () => {
    // Simulate an admin having revoked the default grant after install —
    // the exact scenario BUILD_PLAN.md risk #4's regression test targets.
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'itest_fixture.items.view' } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
    });

    // Ship v2: bumped version + a new migration + a new permission.
    const moduleDir = join(modulesDir, MODULE_KEY);
    writeFileSync(join(moduleDir, 'manifest.json'), JSON.stringify(manifestV2(), null, 2));
    writeFileSync(
      join(moduleDir, 'migrations', '0002_add_description_column.sql'),
      'ALTER TABLE itest_fixture_items ADD COLUMN description TEXT;\n',
    );

    const result = await moduleRegistry.upgrade(MODULE_KEY, undefined);

    expect(result.status).toBe('installed');
    expect(result.version).toBe('2.0.0');

    // The new migration genuinely ran.
    expect(await columnExists('itest_fixture_items', 'description')).toBe(true);
    const newMigrationRow = await prisma.moduleMigration.findUnique({
      where: { moduleKey_filename: { moduleKey: MODULE_KEY, filename: '0002_add_description_column.sql' } },
    });
    expect(newMigrationRow).not.toBeNull();

    // The manually-revoked grant was NOT silently re-applied.
    const stillRevoked = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
    });
    expect(stillRevoked).toBeNull();

    // The brand-new permission introduced by the upgrade exists in the
    // catalog but has ZERO grants anywhere (upgrade() never grants defaults).
    const newPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'itest_fixture.items.edit' } });
    const grantsOfNewPermission = await prisma.rolePermission.findMany({ where: { permissionId: newPermission.id } });
    expect(grantsOfNewPermission).toHaveLength(0);
  });

  it('a tampered already-applied migration file fails a REAL checksum comparison and marks the module "failed"', async () => {
    const migrationPath = join(modulesDir, MODULE_KEY, 'migrations', '0001_create_table.sql');
    const original = readFileSync(migrationPath, 'utf8');
    writeFileSync(migrationPath, `${original}\n-- tampered after being applied\n`);

    let caught: unknown;
    try {
      await moduleRegistry.upgrade(MODULE_KEY, undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InternalServerErrorException);
    expect((caught as Error).message).toMatch(/checksum mismatch/i);

    const row = await prisma.moduleRegistryEntry.findUniqueOrThrow({ where: { key: MODULE_KEY } });
    expect(row.status).toBe('failed');
  });

  it('uninstall(dropData: true) runs the down migration for real (table dropped) and de-registers permissions/menu', async () => {
    // uninstall() is reachable from "failed" too (UNINSTALLABLE_STATUSES) —
    // the tampered file above never blocked it (down migrations aren't
    // checksum-tracked).
    const result = await moduleRegistry.uninstall(MODULE_KEY, true);

    expect(result.status).toBe('disabled');
    expect(await tableExists('itest_fixture_items')).toBe(false);

    const remainingPermissions = await prisma.permission.findMany({ where: { moduleKey: MODULE_KEY } });
    expect(remainingPermissions).toHaveLength(0);

    const remainingMenu = await prisma.moduleMenuEntry.findMany({ where: { moduleKey: MODULE_KEY } });
    expect(remainingMenu).toHaveLength(0);

    const remainingMigrationRows = await prisma.moduleMigration.findMany({ where: { moduleKey: MODULE_KEY } });
    expect(remainingMigrationRows).toHaveLength(0);
  });
});
