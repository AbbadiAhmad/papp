import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isProtectedAdminRoleCode } from './permissions-page.guard';
import { toPublicPermission, PublicPermission } from './permission.presenter';

/**
 * The two permission codes that must never be revocable from the `admin`
 * role (see `setRoleGrants` below). Structurally prevents the platform from
 * ever reaching the "admin holds zero grants" state that the old D12
 * `PermissionsPageGuard` bypass existed to work around — see
 * `docs/DECISIONS.md` (the entry superseding D12) and `ARCHITECTURE.md`
 * §7.4 for the full history.
 */
export const ADMIN_PROTECTED_PERMISSION_CODES = ['permissions.view', 'permissions.grant'] as const;

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PublicPermission[]> {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
    return permissions.map(toPublicPermission);
  }

  async getRoleGrants(roleId: string): Promise<string[]> {
    await this.assertRoleExists(roleId);
    const grants = await this.prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
    return grants.map((g) => g.permission.code).sort();
  }

  /**
   * Sets a role's FULL grant set (see SetRoleGrantsDto). Re-validates every
   * code against the live catalog (never trusts the caller's list blindly)
   * and applies the diff in a single transaction.
   *
   * Guarded against ever revoking `permissions.view`/`permissions.grant`
   * from the `admin` role specifically (`assertAdminKeepsProtectedGrants`
   * below) — the structural replacement for the old D12
   * `PermissionsPageGuard` bypass: once admin can never actually lose these
   * two grants, the Permissions page never needs a special-cased access
   * rule, only the same plain `permissions.view` check every other page
   * uses. Every OTHER permission can still be freely revoked from admin,
   * and these two codes can still be freely revoked from any OTHER role —
   * this check is scoped to exactly that one (role, permission-code) pair.
   */
  async setRoleGrants(roleId: string, permissionCodes: string[], grantedBy?: string): Promise<string[]> {
    const role = await this.assertRoleExists(roleId);
    this.assertAdminKeepsProtectedGrants(role.code, permissionCodes);

    const uniqueCodes = Array.from(new Set(permissionCodes));
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: uniqueCodes } } });
    const foundCodes = new Set(permissions.map((p) => p.code));
    const unknownCodes = uniqueCodes.filter((code) => !foundCodes.has(code));
    if (unknownCodes.length > 0) {
      throw new BadRequestException(`Unknown permission code(s): ${unknownCodes.join(', ')}`);
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({
        where: { roleId, permissionId: { notIn: permissions.map((p) => p.id) } },
      }),
      ...permissions.map((permission) =>
        this.prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId: permission.id } },
          update: {},
          create: { roleId, permissionId: permission.id, grantedBy },
        }),
      ),
    ]);

    return this.getRoleGrants(roleId);
  }

  /**
   * The caller's EFFECTIVE permission set, resolved FRESH from
   * `role_permissions` (joined through `user_roles`) on every call — never
   * cached across requests, never read from a JWT claim. This is the single
   * most important behavior of the whole RBAC system (ARCHITECTURE.md §7.2):
   * a grant change must be visible on the very next request.
   */
  async getEffectivePermissionCodes(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { userRoles: { some: { userId } } } },
      select: { permission: { select: { code: true } } },
    });
    return new Set(rows.map((r) => r.permission.code));
  }

  /**
   * The caller's own effective permissions, as full catalog rows (code +
   * category + description key) rather than bare codes — backs the
   * reduced "My Permissions" page (`permissions.view_my`, migration 0010),
   * a self-scoped read distinct from the full admin matrix (`GET
   * /permissions`, `permissions.view`): a user sees only what THEY hold,
   * never every role's grants or another role's editor. Resolved fresh,
   * same "never cached, a grant change is visible on the very next
   * request" guarantee as `getEffectivePermissionCodes`.
   */
  async getMyPermissionDetails(userId: string): Promise<PublicPermission[]> {
    const permissions = await this.prisma.permission.findMany({
      where: { rolePermissions: { some: { role: { userRoles: { some: { userId } } } } } },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
    return permissions.map(toPublicPermission);
  }

  /**
   * Throws `ForbiddenException` iff `roleCode` is the protected `admin` role
   * AND the incoming FULL grant set (`nextPermissionCodes` — this is a
   * full-replace API, not a delta) would drop one of
   * `ADMIN_PROTECTED_PERMISSION_CODES`. Every other role is unaffected, and
   * every other permission code can still be freely revoked from admin.
   * Same exception type as `RolesService.assertNotLastActiveAdmin` — this is
   * the same category of platform-bootstrap safety invariant, just applied
   * to a role's own permission grants instead of a user's role membership.
   */
  private assertAdminKeepsProtectedGrants(roleCode: string, nextPermissionCodes: string[]): void {
    if (!isProtectedAdminRoleCode(roleCode)) {
      return;
    }
    const nextCodes = new Set(nextPermissionCodes);
    const missing = ADMIN_PROTECTED_PERMISSION_CODES.filter((code) => !nextCodes.has(code));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Cannot revoke ${missing.join(', ')} from the admin role — at least one active admin must always be able to view and manage permissions.`,
      );
    }
  }

  private async assertRoleExists(roleId: string): Promise<{ id: string; code: string }> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }
}
