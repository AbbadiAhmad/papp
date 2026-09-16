import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PermissionsService } from './permissions.service';

/**
 * *** THE single hard-coded D12 exception in the entire codebase. ***
 *
 * ARCHITECTURE.md §7.4 / docs/DECISIONS.md D12: "Admin always has access to
 * the Permissions page, regardless of its own permission grants." This is
 * the one, explicit, code-reviewed bypass — checking `role.code === 'admin'`
 * IN ADDITION TO the normal permission check (OR, not instead of).
 *
 * This must be the ONLY file anywhere in this codebase containing a
 * role-name-shaped conditional (`role.code === 'admin'`, `.includes('admin')`,
 * a string-literal role check, etc.). If you think you need a second one —
 * e.g. "admin should always see the Modules screen too" — the answer is
 * always "grant admin the permission by default in the seed migration,
 * don't hardcode a second bypass." Stop and raise it with the user instead.
 * (Enforced later by scripts/lint-no-hardcoded-roles.ts, Phase 7 — this
 * comment is the primary defense in the meantime.)
 *
 * Applied via `@PermissionCheckDelegatedToPermissionsPageGuard()` only on
 * the read-only routes the Permissions PAGE itself needs to fully render
 * and operate for a zero-grant admin: the grant-management sub-resource
 * (`PermissionsController`'s `roles/:roleId/grants`) and the two catalog
 * listings that sub-resource's UI is built from (`GET /permissions`,
 * `GET /roles` — widened in Phase 6 after real-browser testing showed a
 * zero-grant admin could edit grants but not see the catalogs needed to
 * render the matrix in the first place). Everywhere else in the codebase
 * uses plain `PermissionGuard`, with no admin bypass, full stop — this
 * remains the only FILE containing role-name-shaped logic, per D12.
 *
 * Role codes are resolved FRESH from the database on every request
 * (`PermissionsService.getRoleCodesForUser`), exactly like effective
 * permissions — never cached, never read from a JWT claim. See this
 * Developer agent's report for the reasoning on why roles are looked up
 * fresh rather than embedded in the access token for this phase.
 */
/**
 * Phase 5 (global-guard switch): now that `PermissionGuard` is registered as
 * a global APP_GUARD, it would run on the grant-management endpoints too and
 * reject an admin who lacks the literal permission BEFORE this guard's D12
 * bypass ever gets a chance — silently breaking "admin always has access to
 * the Permissions page." This metadata key tells the global `PermissionGuard`
 * to stand down on exactly the handlers where THIS guard is applied instead.
 *
 * It lives in this file on purpose: it is part of the same single sanctioned
 * D12 exception, not a general-purpose escape hatch. Never apply
 * `@PermissionCheckDelegatedToPermissionsPageGuard()` to a handler that does
 * not also carry `@UseGuards(PermissionsPageGuard)` — that would leave the
 * handler with NO permission check at all.
 */
export const PERMISSION_CHECK_DELEGATED_KEY = 'permissionCheckDelegatedToPermissionsPageGuard';
export const PermissionCheckDelegatedToPermissionsPageGuard = (): MethodDecorator =>
  SetMetadata(PERMISSION_CHECK_DELEGATED_KEY, true);

@Injectable()
export class PermissionsPageGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: AuthenticatedUser }).user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const roleCodes = await this.permissionsService.getRoleCodesForUser(user.userId);
    if (roleCodes.includes('admin')) {
      // *** THE one sanctioned exception — see file-level docblock. ***
      return true;
    }

    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermission) {
      return true;
    }

    const effectivePermissions = await this.permissionsService.getEffectivePermissionCodes(user.userId);
    if (!effectivePermissions.has(requiredPermission)) {
      throw new ForbiddenException(`Missing required permission: ${requiredPermission}`);
    }
    return true;
  }
}
