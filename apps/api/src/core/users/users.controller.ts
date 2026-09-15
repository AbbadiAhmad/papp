import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicUser } from './user.presenter';
import { UsersService } from './users.service';

/**
 * Guarded by JwtAuthGuard (+ MustChangePasswordGuard) only for now —
 * `@RequirePermission` codes (`users.view/create/update/delete`) are added
 * retroactively in Phase 2 once PermissionGuard exists, per
 * docs/BUILD_PLAN.md's Phase 1 scope note. Excel import/export is
 * deliberately NOT built here (Phase 2 — needs the role column).
 */
@Controller('users')
@UseGuards(JwtAuthGuard, MustChangePasswordGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.findById(user.userId);
  }

  @Get()
  async list(): Promise<PublicUser[]> {
    return this.usersService.list();
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<PublicUser> {
    return this.usersService.findById(id);
  }

  @Post()
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.create(dto, user.userId);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<PublicUser> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.remove(id);
  }
}
