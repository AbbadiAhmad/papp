import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { SetRoleGrantsDto } from './dto/set-role-grants.dto';
import { PublicPermission } from './permission.presenter';
import { PermissionsPageGuard } from './permissions-page.guard';
import { PermissionsService } from './permissions.service';

/**
 * The catalog-listing endpoint uses the normal `PermissionGuard` (no D12
 * bypass — you need `permissions.view` to see the catalog, same as anything
 * else). Only the grant-management sub-resource
 * (`roles/:roleId/grants`) — "the Permissions page" D12 is actually about —
 * uses `PermissionsPageGuard` instead. See that guard's docblock.
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

@Controller('permissions')
@UseGuards(JwtAuthGuard, MustChangePasswordGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions.view')
  async list(): Promise<PublicPermission[]> {
    return this.permissionsService.list();
  }

  @Get('roles/:roleId/grants')
  @UseGuards(PermissionsPageGuard)
  @RequirePermission('permissions.view')
  async getRoleGrants(@Param('roleId') roleId: string): Promise<string[]> {
    return this.permissionsService.getRoleGrants(roleId);
  }

  @Put('roles/:roleId/grants')
  @UseGuards(PermissionsPageGuard)
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
