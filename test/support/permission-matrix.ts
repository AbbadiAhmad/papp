/**
 * The permission-matrix test helper (docs/TESTING_STRATEGY.md §2). Lives at
 * the repo root — not inside apps/api or apps/web — because a later phase
 * needs it importable from both backend e2e tests and possibly frontend e2e
 * tests, e.g.:
 *
 *   import { expectPermissionEnforced } from '../../../test/support/permission-matrix';
 *
 * **Phase 0 stub only.** Roles/permissions/PermissionGuard/token issuance
 * don't exist yet (they arrive in Phase 1/2 — see docs/BUILD_PLAN.md), so
 * there is nothing real to check a permission matrix against. This file's
 * only job right now is to settle the function's signature and import path
 * so Phase 1/2 test files can already write the import above without it
 * changing later. Phase 2's Tester implements the real body.
 */

export interface ExpectPermissionEnforcedOptions {
  /** HTTP method of the endpoint under test. */
  method: 'get' | 'post' | 'patch' | 'delete';
  /** Request path, e.g. "/users/:id" with concrete values substituted. */
  path: string;
  /** The permission code the endpoint is expected to require, e.g. "users.create". */
  requiredPermission: string;
  /** A body that would succeed if the caller were authorized (for post/patch). */
  validBody?: object;
}

/**
 * Registers a Jest test (per docs/TESTING_STRATEGY.md §2) that, once
 * implemented, spins through every role and asserts:
 *  - a role holding `requiredPermission` (directly or via manifest default) -> success status,
 *  - a role that does not hold it -> 403,
 *  - no auth token at all -> 401.
 *
 * TODO(Phase 2): implement for real once RolesModule/PermissionsModule/
 * PermissionGuard and token issuance exist. Until then this throws so a
 * spec file that calls it prematurely fails loudly and obviously, instead
 * of silently asserting nothing.
 */
export function expectPermissionEnforced(_opts: ExpectPermissionEnforcedOptions): void {
  throw new Error(
    'expectPermissionEnforced() is not implemented yet (Phase 0 stub — see ' +
      'docs/BUILD_PLAN.md Phase 2 "Tester builds" and docs/TESTING_STRATEGY.md §2). ' +
      'Do not call this from a test until Phase 2 implements it for real.',
  );
}
