/**
 * Structural stand-in for core's `PermissionsService` (same pattern and
 * reasoning as `modules/library_circulation/backend/permission-checker.ts`).
 * `reading-club.module.ts` is the one place binding the real class.
 */
export const PERMISSION_CHECKER = Symbol('PERMISSION_CHECKER');

export interface PermissionChecker {
  getEffectivePermissionCodes(userId: string): Promise<Set<string>>;
}
