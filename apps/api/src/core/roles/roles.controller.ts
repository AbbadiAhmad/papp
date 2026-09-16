import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { PermissionCheckDelegatedToPermissionsPageGuard, PermissionsPageGuard } from '../permissions/permissions-page.guard';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PublicRole } from './role.presenter';
import { RolesService } from './roles.service';

// Phase 3 @Audit fetchState helpers (see AuditInterceptor's docblock).
const fetchRoleState = (prisma: PrismaService, req: Request) =>
  prisma.role.findUnique({ where: { id: req.params.id as string } });

// For assign/unassign the audited entity is the UserRole link row: null
// before an assign / after an unassign, present on the other side — the
// old/new pair captures the membership change.
const fetchUserRoleState = (prisma: PrismaService, req: Request) =>
  prisma.userRole.findUnique({
    where: { userId_roleId: { userId: req.params.userId as string, roleId: req.params.id as string } },
  });

// Phase 5 global-guard switch: JwtAuthGuard/PermissionGuard are now global
// (app.module.ts) — only MustChangePasswordGuard stays controller-scoped.
@Controller('roles')
@UseGuards(MustChangePasswordGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // Phase 6 extension of D12 (see permissions.controller.ts's matching
  // docblock): the Permissions page needs the role catalog to render its
  // matrix, so this listing delegates to PermissionsPageGuard too — for
  // every non-admin caller this is byte-for-byte the same `roles.view`
  // check it replaced; only the `admin` role's own zero-grant case changes.
  @Get()
  @UseGuards(PermissionsPageGuard)
  @PermissionCheckDelegatedToPermissionsPageGuard()
  @RequirePermission('roles.view')
  async list(): Promise<PublicRole[]> {
    return this.rolesService.list();
  }

  @Get('user/:userId')
  @RequirePermission('roles.view')
  async listForUser(@Param('userId') userId: string): Promise<PublicRole[]> {
    return this.rolesService.listRolesForUser(userId);
  }

  @Get(':id')
  @RequirePermission('roles.view')
  async findById(@Param('id') id: string): Promise<PublicRole> {
    return this.rolesService.findById(id);
  }

  @Post()
  @RequirePermission('roles.create')
  @Audit({ category: 'core.roles', entityType: 'Role', action: 'create' })
  async create(@Body() dto: CreateRoleDto): Promise<PublicRole> {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('roles.update')
  @Audit({ category: 'core.roles', entityType: 'Role', action: 'update', fetchState: fetchRoleState })
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto): Promise<PublicRole> {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('roles.delete')
  @Audit({ category: 'core.roles', entityType: 'Role', action: 'delete', fetchState: fetchRoleState })
  async remove(@Param('id') id: string): Promise<void> {
    await this.rolesService.remove(id);
  }

  @Post(':id/users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('roles.assign')
  @Audit({ category: 'core.roles', entityType: 'UserRole', action: 'assign', fetchState: fetchUserRoleState })
  async assign(
    @Param('id') roleId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.rolesService.assignToUser(roleId, userId, user.userId);
  }

  @Delete(':id/users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('roles.assign')
  @Audit({ category: 'core.roles', entityType: 'UserRole', action: 'unassign', fetchState: fetchUserRoleState })
  async unassign(@Param('id') roleId: string, @Param('userId') userId: string): Promise<void> {
    await this.rolesService.unassignFromUser(roleId, userId);
  }
}
