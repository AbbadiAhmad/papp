import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowMustChangePassword } from '../../common/decorators/allow-must-change-password.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditLogWriter } from '../audit/audit-log.writer';
import { AuthService, IssuedTokens } from './auth.service';
import { ForcePasswordChangeDto } from './dto/force-password-change.dto';
import { LoginDto } from './dto/login.dto';
import { REFRESH_TOKEN_COOKIE_NAME } from './jwt.constants';
import { extractRequestMeta } from './request-meta.util';

/**
 * Phase 3: login/logout audit rows are written DIRECTLY by AuthModule
 * (ARCHITECTURE.md §8.2 — there is no before/after state to diff, so the
 * @Audit interceptor is not involved). Success only: a failed login attempt
 * changed nothing to audit, and token refresh rotation is deliberately not a
 * 'login' event. AuditLogWriter never throws, so a failed audit write can
 * never break login/logout themselves (it is loudly logged instead).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditLogWriter: AuditLogWriter,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const meta = extractRequestMeta(req);
    const tokens = await this.authService.login(body.email, body.password, meta);

    await this.auditLogWriter.write({
      actorType: 'user',
      actorUserId: tokens.userId,
      actorSessionId: tokens.sessionId,
      category: 'core.auth',
      entityType: 'User',
      entityId: tokens.userId,
      action: 'login',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as string | undefined;
    const tokens = await this.authService.refresh(rawRefreshToken, extractRequestMeta(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    await this.authService.logout(user.sessionId);

    const meta = extractRequestMeta(req);
    await this.auditLogWriter.write({
      actorType: 'user',
      actorUserId: user.userId,
      actorSessionId: user.sessionId,
      category: 'core.auth',
      entityType: 'User',
      entityId: user.userId,
      action: 'logout',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/auth' });
    return { success: true };
  }

  @Post('force-password-change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
  async forcePasswordChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ForcePasswordChangeDto,
  ): Promise<{ success: true }> {
    await this.authService.forcePasswordChange(user.userId, body.newPassword);
    return { success: true };
  }

  private setRefreshCookie(res: Response, tokens: IssuedTokens): void {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/auth',
      expires: tokens.refreshTokenExpiresAt,
    });
  }
}
