import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PublicRole } from './role.presenter';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(JwtAuthGuard, MustChangePasswordGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
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
  async create(@Body() dto: CreateRoleDto): Promise<PublicRole> {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('roles.update')
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto): Promise<PublicRole> {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('roles.delete')
  async remove(@Param('id') id: string): Promise<void> {
    await this.rolesService.remove(id);
  }

  @Post(':id/users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('roles.assign')
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
  async unassign(@Param('id') roleId: string, @Param('userId') userId: string): Promise<void> {
    await this.rolesService.unassignFromUser(roleId, userId);
  }
}
