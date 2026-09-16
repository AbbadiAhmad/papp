import { SetMetadata } from '@nestjs/common';

export const ALLOW_MUST_CHANGE_PASSWORD_KEY = 'allowMustChangePassword';

/**
 * Marks a route as reachable even when the current session's user has
 * `mustChangePassword=true`. The original two routes this belongs on are
 * AuthController's `logout` and `force-password-change` handlers (see
 * docs/BUILD_PLAN.md Phase 1: "blocks every OTHER endpoint ... except the
 * force-password-change endpoint and logout"). See MustChangePasswordGuard.
 *
 * Also applied to `GET /users/me` (found during Phase 6's real-browser
 * verification): the frontend's only way to learn `mustChangePassword` is
 * that same endpoint, so blocking it created an infinite loop (a 403 from
 * `/users/me` triggering a retry of the very call that produced it). Reading
 * your own profile leaks nothing a force-password-change flow needs to stay
 * hidden — this is a narrow, deliberate third exception, not a precedent for
 * gating this guard loosely.
 */
export const AllowMustChangePassword = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_MUST_CHANGE_PASSWORD_KEY, true);
