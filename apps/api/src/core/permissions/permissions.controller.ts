import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { SetRoleGrantsDto } from './dto/set-role-grants.dto';
import { PublicPermission } from './permission.presenter';
import { PermissionsService } from './permissions.service';

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

  /**
   * The reduced "My Permissions" view: the caller's OWN effective grants,
   * as full catalog rows — distinct from the admin `GET /permissions`
   * matrix above (plain `permissions.view`). Gated by
   * `permissions.view_my` (migration 0010), seeded to all 4 base roles by
   * default — every account can see what it itself is allowed to do,
   * without needing `permissions.view` (which would also let it see every
   * OTHER role's grants and isn't meant to be universal).
   */
  @Get('me')
  @RequirePermission('permissions.view_my')
  async listMine(@CurrentUser() user: AuthenticatedUser): Promise<PublicPermission[]> {
    return this.permissionsService.getMyPermissionDetails(user.userId);
  }

  @Get()
  @RequirePermission('permissions.view')
  async list(): Promise<PublicPermission[]> {
    return this.permissionsService.list();
  }

  @Get('roles/:roleId/grants')
  @RequirePermission('permissions.view')
  async getRoleGrants(@Param('roleId') roleId: string): Promise<string[]> {
    return this.permissionsService.getRoleGrants(roleId);
  }

  @Put('roles/:roleId/grants')
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
