import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowMustChangePassword } from '../../common/decorators/allow-must-change-password.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicThrottlerGuard } from '../../common/guards/public-throttler.guard';
import { AuditLogWriter } from '../audit/audit-log.writer';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthService, IssuedTokens, RegisteredUser } from './auth.service';
import { ForcePasswordChangeDto } from './dto/force-password-change.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SetupCreateAdminDto } from './dto/setup.dto';
import { REFRESH_TOKEN_COOKIE_NAME } from './jwt.constants';
import { extractRequestMeta } from './request-meta.util';

/**
 * Phase 3: login/logout audit rows are written DIRECTLY by AuthModule
 * (ARCHITECTURE.md §8.2 — there is no before/after state to diff, so the
 * @Audit interceptor is not involved). Success only: a failed login attempt
 * changed nothing to audit, and token refresh rotation is deliberately not a
 * 'login' event. AuditLogWriter never throws, so a failed audit write can
 * never break login/logout themselves (it is loudly logged instead).
 *
 * Phase 5 global-guard switch: `JwtAuthGuard`/`PermissionGuard` are now
 * global (app.module.ts) — `login`/`refresh`/`register` are marked
 * `@Public()` so the (still-running) `JwtAuthGuard` short-circuits to "no
 * user" instead of demanding a Bearer token nobody has yet. `logout` and
 * `force-password-change` no longer need a local `@UseGuards(JwtAuthGuard)`
 * for the same reason — they are NOT `@Public()`, so the global guard still
 * enforces authentication on them exactly as before.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditLogWriter: AuditLogWriter,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
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
  @Public()
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
  @AllowMustChangePassword()
  async forcePasswordChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ForcePasswordChangeDto,
  ): Promise<{ success: true }> {
    await this.authService.forcePasswordChange(user.userId, body.newPassword);
    return { success: true };
  }

  /**
   * D41: self-registration. `@Public()` (no session exists yet) +
   * `PublicThrottlerGuard` (a public WRITE endpoint — never optional per
   * MODULE_SPEC.md §7.3). No `@RequirePermission` — RBAC doesn't apply to an
   * anonymous caller (§7.1). `@Audit` here is the main point of this
   * endpoint from a testing perspective: with `@Public()` set and no
   * `req.user`, AuditInterceptor's actor resolution produces
   * `actor_type='anonymous'` (see its own docblock) — no `fetchState` is
   * given because there is no route param to look the new user up by; the
   * handler's own response body (id/email/name, never a password/hash)
   * becomes `newValue` via the interceptor's fallback.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Public()
  @UseGuards(PublicThrottlerGuard)
  @Audit({ category: 'core.auth', entityType: 'User', action: 'register' })
  async register(@Body() body: RegisterDto): Promise<RegisteredUser> {
    return this.authService.register(body);
  }

  /**
   * Root D60/A27 (UI-wizard option): read-only, `@Public()` (no session can
   * exist yet on a fresh install), no `PublicThrottlerGuard` — it's a GET
   * with no side effect, not a write endpoint (MODULE_SPEC.md §7.3's
   * mandatory throttle applies to public WRITEs). The frontend polls this
   * before deciding whether to route to SetupPage or LoginPage.
   */
  @Get('setup-status')
  @Public()
  async getSetupStatus(): Promise<{ setupNeeded: boolean }> {
    return { setupNeeded: await this.authService.isSetupNeeded() };
  }

  /**
   * D41 follow-up: read-only, `@Public()` (no session exists for an
   * anonymous visitor deciding whether to show a "create an account" link),
   * no `PublicThrottlerGuard` — a GET with no side effect, same reasoning as
   * `getSetupStatus()` above. The frontend's LoginPage calls this once to
   * decide whether to render the register link/route at all; `register()`
   * itself re-checks the same setting independently, so this is never the
   * real enforcement point.
   */
  @Get('registration-status')
  @Public()
  async getRegistrationStatus(): Promise<{ allowSelfRegistration: boolean }> {
    return { allowSelfRegistration: await this.authService.isSelfRegistrationOpen() };
  }

  /**
   * Root D60/A27: creates the first admin account on a fresh install.
   * `@Public()` + `PublicThrottlerGuard` (a public WRITE — never optional,
   * same as `register()`). The real "only when no users exist yet" guard is
   * server-side inside `AuthService.setupCreateFirstAdmin`'s transaction —
   * `getSetupStatus()` above is a UX convenience for the frontend, not the
   * enforcement point. `@Audit` here mirrors `register()`: `@Public()` with
   * no `req.user` makes AuditInterceptor record `actor_type='anonymous'`.
   */
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  @Public()
  @UseGuards(PublicThrottlerGuard)
  @Audit({ category: 'core.auth', entityType: 'User', action: 'setup_create_first_admin' })
  async setup(@Body() body: SetupCreateAdminDto): Promise<RegisteredUser> {
    return this.authService.setupCreateFirstAdmin(body);
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
