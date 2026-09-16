import { Controller, Delete, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { PublicSession } from './session.presenter';
import { SessionsService } from './sessions.service';

// Phase 3 @Audit fetchState: the raw session row (refreshTokenHash is
// `/// @Sensitive`, so it lands as "[redacted]"); old/new captures
// revokedAt flipping from null to a timestamp.
const fetchSessionState = (prisma: PrismaService, req: Request) =>
  prisma.userSession.findUnique({ where: { id: req.params.id as string } });

/**
 * Retrofitted in Phase 2 with `@RequirePermission(...)` (docs/BUILD_PLAN.md
 * Phase 2 step 7). `GET /sessions/me` deliberately carries no
 * `@RequirePermission` for the same self-scoped reason as `GET /users/me` —
 * every role must be able to see their own active sessions regardless of
 * grants.
 *
 * Phase 5 global-guard switch: `JwtAuthGuard`/`PermissionGuard` are now
 * global (app.module.ts) — only `MustChangePasswordGuard` stays
 * controller-scoped (see its own docblock).
 */
@Controller('sessions')
@UseGuards(MustChangePasswordGuard)
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
  @Audit({ category: 'core.sessions', entityType: 'UserSession', action: 'revoke', fetchState: fetchSessionState })
  async revoke(@Param('id') id: string): Promise<void> {
    await this.sessionsService.revoke(id);
  }
}
