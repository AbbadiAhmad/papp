import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createParamDecorator } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';

/**
 * *** Why this file exists (read before touching it) ***
 *
 * Copied from modules/library_catalog/backend/platform.ts (D57) — see that
 * file's own docblock for the full rationale. Short version: a dynamically-
 * installed module (MODULE_SPEC.md §1/§4, D15) can't import
 * `apps/api/src/common/**` directly (that TS source tree is never present as
 * loadable JS at the path a running process would need), so every module
 * re-declares `@Public()`/`@RequirePermission()`/`@Audit()`/`@CurrentUser()`
 * as thin metadata shims against the EXACT SAME literal keys the real global
 * guards read — a plugin-contract, not a reimplementation of any actual
 * security/audit logic, which still runs entirely inside core's own global
 * guards/interceptor. `MustChangePasswordGuard` is different: real, if small,
 * business logic, reimplemented in full here (not global — every controller
 * applies it locally, same as core's own).
 *
 * `PublicThrottlerGuard` is NOT re-implemented here either: this module
 * imports the REAL class from `apps/api/dist/common/guards/public-throttler.guard`
 * (built output, not `src/`) for its own public survey-taking routes — see
 * backend/public-survey.controller.ts.
 */

// --- @Public() ----------------------------------------------------------
// Mirrors apps/api/src/common/decorators/public.decorator.ts exactly.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

// --- @RequirePermission(code) --------------------------------------------
// Mirrors apps/api/src/common/decorators/require-permission.decorator.ts exactly.
export const REQUIRE_PERMISSION_KEY = 'requiredPermission';
export const RequirePermission = (code: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, code);

// --- @Audit({...}) --------------------------------------------------------
// Mirrors apps/api/src/common/decorators/audit.decorator.ts exactly,
// PrismaClient substituted for PrismaService (structurally compatible —
// PrismaService just adds lifecycle hooks) so this file needs no core import.
export const AUDIT_KEY = 'auditMetadata';

export interface AuditMetadata {
  category: string;
  entityType: string;
  action: string;
  fetchState?: (prisma: PrismaClient, request: Request) => Promise<object | null>;
  entityIdParam?: string;
}

export const Audit = (metadata: AuditMetadata): MethodDecorator => SetMetadata(AUDIT_KEY, metadata);

// --- @CurrentUser() -------------------------------------------------------
// Mirrors apps/api/src/common/decorators/current-user.decorator.ts exactly.
export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  email: string;
  mustChangePassword: boolean;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user as AuthenticatedUser;
});

// --- MustChangePasswordGuard ----------------------------------------------
// Real (small) reimplementation — see this file's docblock above.
const ALLOW_MUST_CHANGE_PASSWORD_KEY = 'allowMustChangePassword';

@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { mustChangePassword?: boolean } | undefined;
    if (user?.mustChangePassword) {
      throw new ForbiddenException('Password change required before continuing');
    }
    return true;
  }
}
