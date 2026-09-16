import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { SetRoleGrantsDto } from './dto/set-role-grants.dto';
import { PublicPermission } from './permission.presenter';
import { PermissionCheckDelegatedToPermissionsPageGuard, PermissionsPageGuard } from './permissions-page.guard';
import { PermissionsService } from './permissions.service';

/**
 * Phase 6 extension of D12 (found via real-browser verification: a
 * zero-grant admin could reach the grants sub-resource per the original D12
 * exception, but not `GET /permissions` — so the Permissions page itself
 * couldn't render its own matrix rows for that exact admin). The catalog
 * listing here now ALSO delegates to `PermissionsPageGuard` via
 * `@PermissionCheckDelegatedToPermissionsPageGuard()`, same as the grants
 * sub-resource — this does not add a second hardcoded role check anywhere
 * (`PermissionsPageGuard` in `permissions-page.guard.ts` remains the one
 * file with that logic, per ARCHITECTURE.md §7.4); it only widens which
 * routes are ALLOWED to delegate to that single, already-sanctioned guard.
 * For every non-admin caller the behavior is byte-for-byte identical to the
 * plain `permissions.view` check this replaced — the delegation only ever
 * changes the outcome for the `admin` role itself (`GET /roles`'s analogous
 * `roles.view` listing got the same treatment, see roles.controller.ts).
 */
// Phase 3 @Audit fetchState: the role's grant list as sorted codes — called
// before AND after the handler by AuditInterceptor, so the audit row's
// old/new pair is the full grant diff (ARCHITECTURE.md §8.2).
const fetchRoleGrantsState = async (prisma: PrismaService, req: Request) => {
  const grants = await prisma.rolePermission.findMany({
    where: { roleId: req.params.roleId as string },
    include: { permission: { select: { code: true } } },
  });
  return { permissionCodes: grants.map((g) => g.permission.code).sort() };
};

// Phase 5 global-guard switch: JwtAuthGuard/PermissionGuard are now global
// (app.module.ts) — only MustChangePasswordGuard stays controller-scoped.
@Controller('permissions')
@UseGuards(MustChangePasswordGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @UseGuards(PermissionsPageGuard)
  @PermissionCheckDelegatedToPermissionsPageGuard()
  @RequirePermission('permissions.view')
  async list(): Promise<PublicPermission[]> {
    return this.permissionsService.list();
  }

  @Get('roles/:roleId/grants')
  @UseGuards(PermissionsPageGuard)
  @PermissionCheckDelegatedToPermissionsPageGuard()
  @RequirePermission('permissions.view')
  async getRoleGrants(@Param('roleId') roleId: string): Promise<string[]> {
    return this.permissionsService.getRoleGrants(roleId);
  }

  @Put('roles/:roleId/grants')
  @UseGuards(PermissionsPageGuard)
  @PermissionCheckDelegatedToPermissionsPageGuard()
  @RequirePermission('permissions.grant')
  @Audit({
    category: 'core.permissions',
    entityType: 'Role',
    action: 'permission_grant',
    entityIdParam: 'roleId',
    fetchState: fetchRoleGrantsState,
  })
  async setRoleGrants(
    @Param('roleId') roleId: string,
    @Body() dto: SetRoleGrantsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<string[]> {
    return this.permissionsService.setRoleGrants(roleId, dto.permissionCodes, user.userId);
  }
}
