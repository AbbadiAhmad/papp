import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';

/**
 * Blocks every endpoint except the ones explicitly marked
 * `@AllowMustChangePassword()` (AuthController's `logout` and
 * `force-password-change`) when the current session's user has
 * `mustChangePassword=true`.
 *
 * Must run AFTER JwtAuthGuard has populated `request.user` — apply both
 * together, in order, via `@UseGuards(JwtAuthGuard, MustChangePasswordGuard)`
 * on every controller that needs the block (UsersController,
 * SessionsController). It is intentionally NOT registered as a global
 * `APP_GUARD`: Nest runs global guards before controller-scoped ones, so a
 * global registration here would run before JwtAuthGuard populates
 * `request.user` on any controller where JwtAuthGuard is itself only
 * controller-scoped (see jwt-auth.guard.ts's own note on why it isn't
 * global yet either) — pairing them explicitly keeps the ordering correct
 * without relying on global-provider registration order. It still achieves
 * "blocks every OTHER endpoint" for the whole of Phase 1's authenticated
 * surface, which is exactly Users + Sessions + Auth's own logout/
 * force-password-change.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { mustChangePassword?: boolean } | undefined;
    if (user?.mustChangePassword) {
      throw new ForbiddenException('Password change required before continuing');
    }
    return true;
  }
}
