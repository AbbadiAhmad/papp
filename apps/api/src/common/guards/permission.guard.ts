import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSION_CHECK_DELEGATED_KEY } from '../../core/permissions/permissions-page.guard';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Resolves the caller's EFFECTIVE permission set fresh from `role_permissions`
 * on EVERY single request (via `PermissionsService.getEffectivePermissionCodes`,
 * which joins `user_roles` -> `role_permissions` -> `permissions`) — never
 * cached, never read from a JWT claim (ARCHITECTURE.md §7.2 / risk #1 in
 * BUILD_PLAN.md). A grant change must be visible on the very next request.
 *
 * Phase 5: registered as a GLOBAL `APP_GUARD` in AppModule (after
 * `JwtAuthGuard`, which populates `request.user`), now that `@Public()`
 * exists to exempt the endpoints that must stay reachable without a session.
 * "Guards applied everywhere, no exceptions" (MODULE_SPEC.md §7.2) is now
 * literally true — no controller opts in or can forget to.
 *
 * Behavior matrix:
 *  - No `@RequirePermission(...)` metadata → allowed through. Used for the
 *    self-scoped `/me` endpoints (authenticated is enough — they only return
 *    the caller's own data) and for `@Public()` routes, which carry no
 *    permission by design (RBAC is meaningless for anonymous visitors,
 *    MODULE_SPEC.md §7.1).
 *  - `@RequirePermission` + no user + route `@Public()` → allowed (an
 *    anonymous request to a public route never permission-checks). This
 *    combination shouldn't normally exist — public routes shouldn't declare
 *    permissions — but if it does, a LOGGED-IN caller hitting it IS still
 *    checked (next branch), per BUILD_PLAN.md Phase 5 ("still enforces when
 *    a user is present").
 *  - `@RequirePermission` + user present → permission check, public or not.
 *  - `@RequirePermission` + no user + NOT public → 401 (JwtAuthGuard missing
 *    would be a wiring bug; with it global this means the route was public
 *    to JwtAuthGuard but not here, which cannot happen — same key).
 *  - `@PermissionCheckDelegatedToPermissionsPageGuard()` → stand down; the
 *    route-scoped `PermissionsPageGuard` (the single D12 exception) performs
 *    the check instead, including its admin bypass. See that file.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const delegated = this.reflector.getAllAndOverride<boolean>(PERMISSION_CHECK_DELEGATED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (delegated) {
      // D12: PermissionsPageGuard (controller-scoped, runs after this global
      // guard) owns the check for exactly these handlers.
      return true;
    }

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
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isPublic) {
        // Anonymous visitor on a @Public() route: no roles to check (§7.1).
        return true;
      }
      // JwtAuthGuard is global and uses the same isPublic key, so a missing
      // user on a non-public route can only mean a wiring bug, not a real
      // anonymous request.
      throw new UnauthorizedException('Authentication required');
    }

    const effectivePermissions = await this.permissionsService.getEffectivePermissionCodes(user.userId);
    if (!effectivePermissions.has(requiredPermission)) {
      throw new ForbiddenException(`Missing required permission: ${requiredPermission}`);
    }
    return true;
  }
}
