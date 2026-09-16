import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { ALL_ROLE_CODES, expectPermissionEnforced, fixtureForRole } from '../../../../../test/support/permission-matrix';

/**
 * A real, disposable fixture module written to a temp MODULES_DIR at test
 * time (never committed) — lets this file exercise the REAL install/upgrade/
 * uninstall lifecycle (ModuleRegistryService, real migrations, real
 * `module_registry`/`role_permissions`/`module_migrations` rows) without
 * touching the checked-in `modules/` tree (out of this Tester's write scope)
 * or the existing unit-test-only fixtures under apps/api/test/fixtures/modules
 * (also out of scope to edit — and those don't ship real "up" migrations).
 */
const MODULE_KEY = 'e2e_temp_module';

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    key: MODULE_KEY,
    name: 'E2E Temp Module',
    version: '1.0.0',
    compatibleAppVersion: '>=0.1.0 <1.0.0',
    dependsOn: [],
    description: 'Disposable fixture module for module-registry.e2e-spec.ts',
    migrations: { dir: 'migrations' },
    locales: { supported: ['ar', 'en'], dir: 'locales' },
    permissions: [{ code: `${MODULE_KEY}.items.view`, category: 'items', descriptionKey: `${MODULE_KEY}.perm.items.view` }],
    defaultRolePermissions: { admin: [`${MODULE_KEY}.items.view`] },
    roleAccessPolicy: 'grantable',
    roleAccessLocked: {},
    settings: [],
    routes: [],
    menu: [
      {
        id: `${MODULE_KEY}.root`,
        labelKey: `${MODULE_KEY}.menu.root`,
        parentId: null,
        order: 1,
        route: `/${MODULE_KEY}`,
        requiredPermission: `${MODULE_KEY}.items.view`,
      },
    ],
    frontend: { basePath: `/${MODULE_KEY}`, entry: 'index.tsx', landingPage: `/${MODULE_KEY}` },
    backend: { entry: 'index.ts', apiPrefix: `/${MODULE_KEY}_api` },
    lifecycle: { onInstall: null, onUpgrade: null, onUninstall: null },
    ...overrides,
  };
}

describe('Module Registry (e2e, real install/upgrade/uninstall lifecycle)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;
  let modulesDir: string;
  let previousModulesDir: string | undefined;

  beforeAll(async () => {
    container = await startPostgresTestContainer();

    modulesDir = mkdtempSync(join(tmpdir(), 'papp-e2e-modules-'));
    mkdirSync(join(modulesDir, MODULE_KEY, 'migrations'), { recursive: true });
    mkdirSync(join(modulesDir, MODULE_KEY, 'locales'), { recursive: true });
    writeFileSync(join(modulesDir, MODULE_KEY, 'manifest.json'), JSON.stringify(baseManifest()));
    writeFileSync(
      join(modulesDir, MODULE_KEY, 'migrations', '0001_create_items.sql'),
      'CREATE TABLE IF NOT EXISTS e2e_temp_module_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), label TEXT NOT NULL);',
    );
    writeFileSync(join(modulesDir, MODULE_KEY, 'locales', 'ar.json'), JSON.stringify({}));
    writeFileSync(join(modulesDir, MODULE_KEY, 'locales', 'en.json'), JSON.stringify({}));

    previousModulesDir = process.env.MODULES_DIR;
    process.env.MODULES_DIR = modulesDir;

    app = await createTestApp();
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
    if (previousModulesDir === undefined) delete process.env.MODULES_DIR;
    else process.env.MODULES_DIR = previousModulesDir;
    rmSync(modulesDir, { recursive: true, force: true });
  });

  describe('permission matrix', () => {
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/modules', requiredPermission: 'modules.view' });
  });

  it('POST /modules/install requires modules.install, 401s anonymously, and 403s an unauthorized role', async () => {
    const reader = await fixtureForRole(app!, 'reader');
    const forbidden = await request(app!.getHttpServer())
      .post('/modules/install')
      .set('Authorization', `Bearer ${reader.token}`)
      .send({ key: MODULE_KEY });
    expect(forbidden.status).toBe(403);

    const anon = await request(app!.getHttpServer()).post('/modules/install').send({ key: MODULE_KEY });
    expect(anon.status).toBe(401);
  });

  it('really installs the fixture module: registry row, migration applied, permission + default grant seeded, D15 orchestrated restart triggered', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const res = await request(app!.getHttpServer())
      .post('/modules/install')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ key: MODULE_KEY });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe(MODULE_KEY);
    expect(res.body.status).toBe('installed');
    expect(res.body.version).toBe('1.0.0');

    // res.on('finish', ...) fires the restart trigger asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();

    const prisma = app!.get(PrismaService);
    const registryRow = await prisma.moduleRegistryEntry.findUniqueOrThrow({ where: { key: MODULE_KEY } });
    expect(registryRow.status).toBe('installed');

    const migrationRow = await prisma.moduleMigration.findUnique({
      where: { moduleKey_filename: { moduleKey: MODULE_KEY, filename: '0001_create_items.sql' } },
    });
    expect(migrationRow).not.toBeNull();

    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: `${MODULE_KEY}.items.view` } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
    });
    expect(grant).not.toBeNull();

    // install has no :key route param and PublicModuleEntry has no "id"
    // field, so AuditInterceptor's default entityId resolution falls back to
    // null here (entityIdParam is only set on upgrade/uninstall, which DO
    // carry a real :key param — see those assertions below).
    const auditRow = await prisma.auditLog.findFirst({
      where: { category: 'core.modules', action: 'install', entityId: null },
    });
    expect(auditRow).not.toBeNull();
    expect((auditRow!.newValue as { key: string }).key).toBe(MODULE_KEY);
  });

  it('installing again while already installed is rejected — idempotent, no duplicate migration application', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const res = await request(app!.getHttpServer())
      .post('/modules/install')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ key: MODULE_KEY });
    expect(res.status).toBe(409);
  });

  it('upgrade applies only the NEW migration and does NOT re-apply defaultRolePermissions over an admin-altered grant', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const prisma = app!.get(PrismaService);

    // Admin manually revokes the module's default grant from admin's own role.
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: `${MODULE_KEY}.items.view` } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
    });

    // Ship v1.1.0: a new migration + a new permission (still defaultRolePermissions: admin gets both).
    const v2 = baseManifest({
      version: '1.1.0',
      permissions: [
        { code: `${MODULE_KEY}.items.view`, category: 'items', descriptionKey: `${MODULE_KEY}.perm.items.view` },
        { code: `${MODULE_KEY}.items.manage`, category: 'items', descriptionKey: `${MODULE_KEY}.perm.items.manage` },
      ],
      defaultRolePermissions: { admin: [`${MODULE_KEY}.items.view`, `${MODULE_KEY}.items.manage`] },
    });
    writeFileSync(join(modulesDir, MODULE_KEY, 'manifest.json'), JSON.stringify(v2));
    writeFileSync(
      join(modulesDir, MODULE_KEY, 'migrations', '0002_add_note.sql'),
      'ALTER TABLE e2e_temp_module_items ADD COLUMN IF NOT EXISTS note TEXT;',
    );

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const res = await request(app!.getHttpServer())
      .post(`/modules/${MODULE_KEY}/upgrade`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(201);
    expect(res.body.version).toBe('1.1.0');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();

    const migrationRow = await prisma.moduleMigration.findUnique({
      where: { moduleKey_filename: { moduleKey: MODULE_KEY, filename: '0002_add_note.sql' } },
    });
    expect(migrationRow).not.toBeNull();

    // New permission exists in the catalog...
    const newPermission = await prisma.permission.findUniqueOrThrow({ where: { code: `${MODULE_KEY}.items.manage` } });
    // ...but upgrade() grants NOTHING new by default (MODULE_SPEC.md §5).
    const newGrant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: newPermission.id } },
    });
    expect(newGrant).toBeNull();

    // And the admin's earlier manual revocation of the ORIGINAL grant is untouched (not silently re-applied).
    const originalGrantStillRevoked = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
    });
    expect(originalGrantStillRevoked).toBeNull();
  });

  it('uninstall (permission-gated, no restart trigger) de-registers permissions/menu immediately and leaves status disabled', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const reader = await fixtureForRole(app!, 'reader');
    const prisma = app!.get(PrismaService);

    const forbidden = await request(app!.getHttpServer())
      .post(`/modules/${MODULE_KEY}/uninstall`)
      .set('Authorization', `Bearer ${reader.token}`)
      .send({});
    expect(forbidden.status).toBe(403);

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const res = await request(app!.getHttpServer())
      .post(`/modules/${MODULE_KEY}/uninstall`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ dropData: false });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('disabled');

    await new Promise((resolve) => setTimeout(resolve, 100));
    // Uninstall deliberately does NOT trigger the orchestrated restart.
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();

    const remainingPermissions = await prisma.permission.findMany({ where: { moduleKey: MODULE_KEY } });
    expect(remainingPermissions).toHaveLength(0);

    const remainingMenu = await prisma.moduleMenuEntry.findMany({ where: { moduleKey: MODULE_KEY } });
    expect(remainingMenu).toHaveLength(0);
  });

  it('installing a manifest that fails cross-platform validation is rejected and leaves no "installed" row', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const badDir = mkdtempSync(join(tmpdir(), 'papp-e2e-bad-module-'));
    mkdirSync(join(badDir, 'bad_module', 'migrations'), { recursive: true });
    writeFileSync(
      join(badDir, 'bad_module', 'manifest.json'),
      JSON.stringify(
        baseManifest({
          key: 'bad_module',
          // Missing 'ar' — fails validateAgainstPlatform's D19 check.
          locales: { supported: ['en'], dir: 'locales' },
          permissions: [],
          defaultRolePermissions: {},
        }),
      ),
    );

    const saved = process.env.MODULES_DIR;
    process.env.MODULES_DIR = badDir;
    try {
      const res = await request(app!.getHttpServer())
        .post('/modules/install')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ key: 'bad_module' });
      expect(res.status).toBe(400);

      const prisma = app!.get(PrismaService);
      const row = await prisma.moduleRegistryEntry.findUnique({ where: { key: 'bad_module' } });
      expect(row?.status).toBe('failed');
    } finally {
      process.env.MODULES_DIR = saved;
      rmSync(badDir, { recursive: true, force: true });
    }
  });
});
