import { Controller, Delete, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { PublicSession } from './session.presenter';
import { SessionsService } from './sessions.service';

/**
 * Guarded by JwtAuthGuard (+ MustChangePasswordGuard) only for now — no
 * `@RequirePermission` yet (Phase 2 retrofits it once PermissionGuard
 * exists; `GET /sessions/user/:userId` in particular has no access
 * restriction beyond "logged in" until then, exactly per
 * docs/BUILD_PLAN.md's Phase 1 scope note).
 */
@Controller('sessions')
@UseGuards(JwtAuthGuard, MustChangePasswordGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('me')
  async getMine(@CurrentUser() user: AuthenticatedUser): Promise<PublicSession[]> {
    return this.sessionsService.listForUser(user.userId);
  }

  @Get('user/:userId')
  async getForUser(@Param('userId') userId: string): Promise<PublicSession[]> {
    return this.sessionsService.listForUser(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param('id') id: string): Promise<void> {
    await this.sessionsService.revoke(id);
  }
}
