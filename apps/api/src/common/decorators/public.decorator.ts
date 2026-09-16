import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks an endpoint (or a whole controller) as reachable with NO login
 * (ARCHITECTURE.md §7.5, MODULE_SPEC.md §7, D34). The guards still run on
 * the route — nothing is ever exempted from the guard chain:
 *
 *  - `JwtAuthGuard` short-circuits to "no user" instead of rejecting (it has
 *    read this exact 'isPublic' key since Phase 1, built ahead for this).
 *  - `PermissionGuard` passes when there is no user AND the route is public;
 *    it still enforces `@RequirePermission` when a user IS present.
 *  - `AuditInterceptor` writes `actor_type='anonymous'` rows for @Audit'ed
 *    public endpoints (branch wired in Phase 3, live from this phase).
 *
 * Public WRITE endpoints must additionally apply `PublicThrottlerGuard`
 * (MODULE_SPEC.md §7.3 — never optional; see the §6 "never" list).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
