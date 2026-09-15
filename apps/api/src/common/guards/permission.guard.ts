import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Resolves the caller's EFFECTIVE permission set fresh from `role_permissions`
 * on EVERY single request (via `PermissionsService.getEffectivePermissionCodes`,
 * which joins `user_roles` -> `role_permissions` -> `permissions`) — never
 * cached, never read from a JWT claim (ARCHITECTURE.md §7.2/§7.2 risk #1 in
 * BUILD_PLAN.md). A grant change must be visible on the very next request.
 *
 * Applied alongside `JwtAuthGuard` (+ `MustChangePasswordGuard`) via
 * `@UseGuards(...)` on controllers, matching the composition pattern Phase 1
 * already established — NOT registered as a global `APP_GUARD` (same
 * reasoning as `JwtAuthGuard`: no `@Public()` mechanism exists yet to exempt
 * routes that must stay reachable without one).
 *
 * A handler with NO `@RequirePermission(...)` metadata at all is allowed
 * through (still requires a valid authenticated session from `JwtAuthGuard`,
 * which must run first) — this is deliberate, used for the two self-scoped
 * `/me` endpoints that must stay reachable by every role regardless of
 * grants, since they only ever return the caller's own data.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: AuthenticatedUser }).user;
    if (!user) {
      // JwtAuthGuard must run before this guard; a missing user here means
      // it wasn't applied, which is a wiring bug, not a real anonymous request.
      throw new UnauthorizedException('Authentication required');
    }

    const effectivePermissions = await this.permissionsService.getEffectivePermissionCodes(user.userId);
    if (!effectivePermissions.has(requiredPermission)) {
      throw new ForbiddenException(`Missing required permission: ${requiredPermission}`);
    }
    return true;
  }
}
