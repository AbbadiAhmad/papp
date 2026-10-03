/**
 * The `admin` role CODE, as a named export — the one other place in the
 * codebase allowed to compare against it is `RolesService`'s
 * last-active-admin guard and `PermissionsService`'s protected-grant guard
 * (see their own docblocks): "the platform must always keep at least one
 * active admin" and "the admin role must always retain `permissions.view`/
 * `permissions.grant`" are the same category of platform-bootstrap/safety
 * concern, so the role-name-shaped comparison itself lives HERE (the one
 * sanctioned file, `scripts/lint-no-hardcoded-roles.ts`'s own allowlist) as a
 * plain, exported constant + helper, imported by value everywhere else
 * needs it — never re-compared against a literal in a second file.
 *
 * This file used to also hold `PermissionsPageGuard`, the D12
 * ("admin always reaches the Permissions page regardless of its own
 * grants") bypass — removed once `permissions.view`/`permissions.grant`
 * became structurally impossible to revoke from `admin` (see
 * `PermissionsService.setRoleGrants`'s guard), which made the D12 bypass
 * unnecessary: an admin can never actually reach a zero-grant state for
 * those two codes any more, so the page never needs a special-cased access
 * rule, only the plain `permissions.view` check every other page already
 * uses. See `docs/ARCHITECTURE.md` §7.4 and `docs/DECISIONS.md` (the entry
 * that supersedes D12) for the full history.
 */
export const PROTECTED_ADMIN_ROLE_CODE = 'admin';

/** `true` iff `code` is the one role every "must always hold X" invariant protects. The only places outside this file allowed to CALL this are the last-active-admin guard (RolesService) and the protected-grant guard (PermissionsService) — never re-implement the comparison itself elsewhere. */
export function isProtectedAdminRoleCode(code: string): boolean {
  return code === PROTECTED_ADMIN_ROLE_CODE;
}
