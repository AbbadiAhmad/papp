/**
 * @papp/shared-types — cross-cutting TypeScript types/DTOs shared by
 * apps/api and apps/web (AuthUser, ManifestSchema, permission-code string
 * literal unions, etc. — see docs/BUILD_PLAN.md §1).
 *
 * Phase 0: intentionally empty. This package exists so the cross-package
 * import path (`@papp/shared-types`) and each app's tsconfig `paths` entry
 * are wired up and provably working before real types land in later phases.
 */

/** Placeholder marker type — remove once the first real shared type lands. */
export type PappSharedTypesPlaceholder = never;
