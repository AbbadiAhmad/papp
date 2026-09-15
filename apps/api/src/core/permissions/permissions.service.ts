import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { toPublicPermission, PublicPermission } from './permission.presenter';

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
   */
  async setRoleGrants(roleId: string, permissionCodes: string[], grantedBy?: string): Promise<string[]> {
    await this.assertRoleExists(roleId);

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
   * The role CODES (not permissions) the user currently holds, resolved
   * fresh. Used only by `PermissionsPageGuard` — the single, explicitly
   * sanctioned D12 exception (ARCHITECTURE.md §7.4) — and nowhere else.
   */
  async getRoleCodesForUser(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return userRoles.map((ur) => ur.role.code);
  }

  private async assertRoleExists(roleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
  }
}
