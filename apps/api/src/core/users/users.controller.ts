import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AllowMustChangePassword } from '../../common/decorators/allow-must-change-password.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { SetLandingPageDto } from './dto/set-landing-page.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { LandingPageOption } from './landing-page-option';
import { PublicUser } from './user.presenter';
import { UsersService } from './users.service';

/**
 * Retrofitted in Phase 2 with `@RequirePermission(...)` now that
 * `PermissionGuard`/the permission catalog exist (per docs/BUILD_PLAN.md
 * Phase 2 step 7). `GET /users/me` and `GET /users/me/permissions` are the
 * only two endpoints in this controller with NO `@RequirePermission` at
 * all — both are bootstrap plumbing every other page depends on (see each
 * one's own docblock for why gating either would be circular). Every OTHER
 * self-scoped endpoint here (`me/landing-page*`) carries a real, admin-
 * grantable code seeded to all base roles by default, same pattern as
 * `notifications.view` (migration 0006) — root DECISIONS.md: no
 * authenticated page/action is ever gate-free except that bootstrap pair.
 * Excel import/export live in `excel-import.controller.ts` (separate file/
 * permission codes).
 *
 * Phase 3 retrofit: every mutating endpoint carries `@Audit(...)`. The
 * `fetchState` callbacks fetch the RAW Prisma row (passwordHash included) —
 * that is deliberate: AuditLogWriter redacts every `/// @Sensitive` field to
 * "[redacted]" before serialization, and fetching raw is exactly what makes
 * a password change VISIBLE (as a redacted old/new diff) in the audit log
 * without ever leaking the hash (ARCHITECTURE.md §8.3).
 *
 * Phase 5 global-guard switch: `JwtAuthGuard`/`PermissionGuard` are now
 * global (app.module.ts) — only `MustChangePasswordGuard` stays
 * controller-scoped (see its own docblock).
 *
 * Phase 6: `GET /users/me` also carries `@AllowMustChangePassword()` — it's
 * the frontend's only way to learn `mustChangePassword` is true in the first
 * place, so blocking it created an infinite retry loop (found via real
 * browser testing). See that decorator's docblock.
 */
const fetchUserState = (prisma: PrismaService, req: Request) =>
  prisma.user.findUnique({ where: { id: req.params.id as string } });

/** Same fetchState shape, but keyed off the CALLER's own id (self-scoped routes carry no `:id` param). */
const fetchOwnUserState = (prisma: PrismaService, req: Request) => {
  const userId = (req as Request & { user?: { userId: string } }).user?.userId;
  return userId ? prisma.user.findUnique({ where: { id: userId } }) : Promise.resolve(null);
};

@Controller('users')
@UseGuards(MustChangePasswordGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @AllowMustChangePassword()
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.findById(user.userId);
  }

  /**
   * The frontend's real permission-gating source of truth (replaces the
   * old client-side "optimistic until a real 403" cache — see
   * `apps/web/src/shared/permissions.tsx`). Deliberately carries NO
   * `@RequirePermission` — this is the one genuine exception to "no
   * authenticated page/action is ever gate-free" (root DECISIONS.md):
   * gating the endpoint that TELLS the app what a user is allowed to do
   * would be circular (the app can't know whether it may ask what it may
   * do without already knowing what it may do), same bootstrap reasoning
   * as `GET /me` above and `POST /auth/logout`/`force-password-change`.
   * This is plumbing every other page depends on, not a page of its own.
   */
  @Get('me/permissions')
  async getMyPermissions(@CurrentUser() user: AuthenticatedUser): Promise<string[]> {
    return this.usersService.getMyPermissionCodes(user.userId);
  }

  /**
   * Feature: per-user default landing page. Self-scoped but still under
   * the real permission umbrella (root DECISIONS.md — no authenticated
   * page/action is ever gate-free, only truly `@Public()` anonymous routes
   * are exempt): `users.preferences.view_my`/`update_my` (migration 0010)
   * are real, admin-grantable/revocable codes seeded to all 4 base roles
   * by default, same pattern as `notifications.view` (migration 0006).
   */
  @Get('me/landing-page-options')
  @RequirePermission('users.preferences.view_my')
  async getMyLandingPageOptions(@CurrentUser() user: AuthenticatedUser): Promise<LandingPageOption[]> {
    return this.usersService.listLandingPageOptions(user.userId);
  }

  @Patch('me/landing-page')
  @RequirePermission('users.preferences.update_my')
  @Audit({ category: 'core.users', entityType: 'User', action: 'update', fetchState: fetchOwnUserState })
  async setMyLandingPage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetLandingPageDto,
  ): Promise<PublicUser> {
    return this.usersService.setDefaultLandingPage(user.userId, dto.landingPage);
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
  @Audit({ category: 'core.users', entityType: 'User', action: 'create' })
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.create(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermission('users.update')
  @Audit({ category: 'core.users', entityType: 'User', action: 'update', fetchState: fetchUserState })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<PublicUser> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('users.delete')
  @Audit({ category: 'core.users', entityType: 'User', action: 'delete', fetchState: fetchUserState })
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.remove(id);
  }
}
