import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicUser } from './user.presenter';
import { UsersService } from './users.service';

/**
 * Retrofitted in Phase 2 with `@RequirePermission(...)` now that
 * `PermissionGuard`/the permission catalog exist (per docs/BUILD_PLAN.md
 * Phase 2 step 7). `GET /users/me` deliberately carries NO
 * `@RequirePermission` — it is self-scoped (a user reading their own
 * profile) and must stay reachable by every role regardless of grants,
 * exactly like `notifications.view` is granted to everyone by default per
 * ARCHITECTURE.md §12.4. Gating it behind `users.view` would lock `reader`
 * (which gets no user-management grants by default) out of seeing its own
 * account. See `PermissionGuard`'s docblock for why an undecorated handler
 * is allowed through once authenticated. Excel import/export live in
 * `excel-import.controller.ts` (separate file/permission codes).
 */
@Controller('users')
@UseGuards(JwtAuthGuard, MustChangePasswordGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.findById(user.userId);
  }

  @Get()
  @RequirePermission('users.view')
  async list(): Promise<PublicUser[]> {
    return this.usersService.list();
  }

  @Get(':id')
  @RequirePermission('users.view')
  async findById(@Param('id') id: string): Promise<PublicUser> {
    return this.usersService.findById(id);
  }

  @Post()
  @RequirePermission('users.create')
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.create(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermission('users.update')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<PublicUser> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('users.delete')
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.remove(id);
  }
}
