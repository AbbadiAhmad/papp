import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

/**
 * Makes `JwtService` available app-wide (Global) so JwtAuthGuard can be used
 * from any controller (AuthController, SessionsController, UsersController)
 * without every one of their modules separately importing `JwtModule`.
 *
 * Registered with no static secret/expiry: token lifetime is
 * admin-configurable (`auth.token_lifetimes`, D24) and read fresh from
 * SettingsService on every sign/verify call, with `secret`/`expiresIn`
 * passed per-call instead (see jwt.constants.ts's `getJwtSecret()`,
 * AuthService.issueSession, and JwtAuthGuard).
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  exports: [JwtModule],
})
export class JwtSharedModule {}
