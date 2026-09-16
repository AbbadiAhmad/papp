import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';

/**
 * Blocks every endpoint except the ones explicitly marked
 * `@AllowMustChangePassword()` (AuthController's `logout` and
 * `force-password-change`) when the current session's user has
 * `mustChangePassword=true`.
 *
 * Must run AFTER `JwtAuthGuard` has populated `request.user` — that
 * dependency is what matters, not any particular registration style. Phase 5
 * makes both `JwtAuthGuard` and `PermissionGuard` global `APP_GUARD`
 * providers (app.module.ts), and Nest runs ALL global guards, in
 * registration order, before ANY controller-scoped guard. This guard stays
 * controller-scoped (`@UseGuards(MustChangePasswordGuard)`, applied
 * everywhere Phase 1 already applied it: Users/Sessions/Roles/Permissions/
 * Audit/Notifications/Settings/ExcelImport), so the real execution order is
 * now `JwtAuthGuard` (global) → `PermissionGuard` (global) →
 * `MustChangePasswordGuard` (controller-scoped) — `request.user` is
 * populated well before this guard ever runs, satisfying the one thing this
 * guard actually depends on. The one observable difference from Phase 1-4's
 * `JwtAuthGuard → MustChangePasswordGuard → PermissionGuard` order: a caller
 * who BOTH must change their password AND lacks the endpoint's required
 * permission now sees `PermissionGuard`'s 403 ("Missing required
 * permission") instead of this guard's 403 ("Password change required")
 * first. Both are 403s and the endpoint is blocked either way — "blocks
 * every OTHER endpoint until changed" (BUILD_PLAN.md Phase 1's acceptance
 * criterion) still holds, only the specific error message a doubly-blocked
 * caller happens to see differs. Making this guard itself global too was
 * considered (it would restore the exact original ordering) but rejected: it
 * would also need to run on AuthController, which never applies this guard
 * today (logout/force-password-change are precisely its `@AllowMustChangePassword()`
 * escape hatches, and login/refresh/register are `@Public()` with no
 * `request.user` to check at all) — global registration would silently
 * change AuthController's behavior for no benefit.
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
