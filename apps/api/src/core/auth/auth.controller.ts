import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowMustChangePassword } from '../../common/decorators/allow-must-change-password.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService, IssuedTokens } from './auth.service';
import { ForcePasswordChangeDto } from './dto/force-password-change.dto';
import { LoginDto } from './dto/login.dto';
import { REFRESH_TOKEN_COOKIE_NAME } from './jwt.constants';
import { extractRequestMeta } from './request-meta.util';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const tokens = await this.authService.login(body.email, body.password, extractRequestMeta(req));
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    await this.authService.logout(user.sessionId);
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
