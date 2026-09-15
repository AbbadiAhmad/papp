import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requiredPermission';

/**
 * Declares the single permission code an endpoint needs. Read by
 * `PermissionGuard` (and `PermissionsPageGuard`, the one D12 exception) via
 * `Reflector`. A handler with no `@RequirePermission(...)` at all is treated
 * as "authenticated is enough" by `PermissionGuard` (see its own docblock) —
 * used deliberately for the two self-scoped `/me` endpoints
 * (`GET /users/me`, `GET /sessions/me`), which must stay reachable by every
 * role regardless of grants since they only ever return the caller's own data.
 */
export const RequirePermission = (code: string): MethodDecorator & ClassDecorator => SetMetadata(REQUIRE_PERMISSION_KEY, code);
