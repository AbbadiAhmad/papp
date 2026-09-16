import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PermissionsService } from '../../../src/core/permissions/permissions.service';
import { RolesService } from '../../../src/core/roles/roles.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';

/**
 * Tier 2: the single most important RBAC guarantee (ARCHITECTURE.md §7.2) —
 * "a grant change must be visible on the very next request" — proved against
 * a REAL database, not a mock that can be made to return anything. Also
 * covers a real-DB-only fact Tier 1 cannot: role_permissions/user_roles
 * really `ON DELETE CASCADE` when a role is deleted (schema.prisma's
 * `onDelete: Cascade`), so a deleted role's grants can never linger and
 * silently keep affecting a user's effective permission set.
 */
describe('PermissionsService grants (integration, real DB, no caching)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let permissionsService: PermissionsService;
  let rolesService: RolesService;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    permissionsService = app.get(PermissionsService);
    rolesService = app.get(RolesService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  async function createUser(): Promise<string> {
    const passwordHash = await argon2.hash('whatever-password', { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, name: 'Grant Test User', passwordHash },
    });
    return user.id;
  }

  it('granting then revoking a permission is reflected on the very next fresh query — no caching layer to invalidate', async () => {
    const role = await rolesService.create({ code: `it_role_${randomUUID().slice(0, 8)}`, nameI18nKey: 'core.roles.test' });
    const userId = await createUser();
    await rolesService.assignToUser(role.id, userId);

    expect(await permissionsService.getEffectivePermissionCodes(userId)).toEqual(new Set());

    await permissionsService.setRoleGrants(role.id, ['audit.view'], randomUUID());

    // Immediately re-queried — no cache to warm, no delay to wait out.
    const afterGrant = await permissionsService.getEffectivePermissionCodes(userId);
    expect(afterGrant.has('audit.view')).toBe(true);
    expect(await permissionsService.getRoleGrants(role.id)).toEqual(['audit.view']);

    await permissionsService.setRoleGrants(role.id, [], randomUUID());

    const afterRevoke = await permissionsService.getEffectivePermissionCodes(userId);
    expect(afterRevoke.has('audit.view')).toBe(false);
    expect(await permissionsService.getRoleGrants(role.id)).toEqual([]);
  });

  it('setRoleGrants replaces the FULL grant set in one transaction: an old code not in the new list is really gone from role_permissions', async () => {
    const role = await rolesService.create({ code: `it_role_${randomUUID().slice(0, 8)}`, nameI18nKey: 'core.roles.test' });

    await permissionsService.setRoleGrants(role.id, ['audit.view', 'audit.purge'], randomUUID());
    expect(await permissionsService.getRoleGrants(role.id)).toEqual(['audit.purge', 'audit.view']);

    await permissionsService.setRoleGrants(role.id, ['audit.view'], randomUUID());
    expect(await permissionsService.getRoleGrants(role.id)).toEqual(['audit.view']);

    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'audit.purge' } });
    const stray = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    expect(stray).toBeNull(); // really deleted, not just excluded from a computed view
  });

  it('deleting a role really CASCADEs role_permissions and user_roles at the DB level (ON DELETE CASCADE)', async () => {
    const role = await rolesService.create({ code: `it_role_${randomUUID().slice(0, 8)}`, nameI18nKey: 'core.roles.test' });
    const userId = await createUser();
    await rolesService.assignToUser(role.id, userId);
    await permissionsService.setRoleGrants(role.id, ['audit.view'], randomUUID());

    expect((await permissionsService.getEffectivePermissionCodes(userId)).has('audit.view')).toBe(true);

    await rolesService.remove(role.id);

    // No orphaned rows left behind by the cascade, and no error resolving a
    // user whose only role just vanished out from under it.
    const orphanRolePermissions = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    expect(orphanRolePermissions).toHaveLength(0);
    const orphanUserRoles = await prisma.userRole.findMany({ where: { roleId: role.id } });
    expect(orphanUserRoles).toHaveLength(0);
    expect(await permissionsService.getEffectivePermissionCodes(userId)).toEqual(new Set());
  });
});
