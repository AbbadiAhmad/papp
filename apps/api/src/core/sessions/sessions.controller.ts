import { Controller, Delete, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PublicSession } from './session.presenter';
import { SessionsService } from './sessions.service';

/**
 * Retrofitted in Phase 2 with `@RequirePermission(...)` (docs/BUILD_PLAN.md
 * Phase 2 step 7). `GET /sessions/me` deliberately carries no
 * `@RequirePermission` for the same self-scoped reason as `GET /users/me` —
 * every role must be able to see their own active sessions regardless of
 * grants.
 */
@Controller('sessions')
@UseGuards(JwtAuthGuard, MustChangePasswordGuard, PermissionGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('me')
  async getMine(@CurrentUser() user: AuthenticatedUser): Promise<PublicSession[]> {
    return this.sessionsService.listForUser(user.userId);
  }

  @Get('user/:userId')
  @RequirePermission('sessions.view')
  async getForUser(@Param('userId') userId: string): Promise<PublicSession[]> {
    return this.sessionsService.listForUser(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('sessions.revoke')
  async revoke(@Param('id') id: string): Promise<void> {
    await this.sessionsService.revoke(id);
  }
}
