import { SetMetadata } from '@nestjs/common';

export const ALLOW_MUST_CHANGE_PASSWORD_KEY = 'allowMustChangePassword';

/**
 * Marks a route as reachable even when the current session's user has
 * `mustChangePassword=true`. The only two routes this belongs on are
 * AuthController's `logout` and `force-password-change` handlers (see
 * docs/BUILD_PLAN.md Phase 1: "blocks every OTHER endpoint ... except the
 * force-password-change endpoint and logout"). See MustChangePasswordGuard.
 */
export const AllowMustChangePassword = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_MUST_CHANGE_PASSWORD_KEY, true);
