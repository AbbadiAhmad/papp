/**
 * @papp/shared-types — cross-cutting TypeScript types/DTOs shared by
 * apps/api and apps/web (ManifestSchema, permission-code string literal
 * unions, etc. — see docs/BUILD_PLAN.md §1). Populated phase by phase.
 *
 * Phase 5: the module manifest schema/types (docs/MODULE_SPEC.md §2).
 */
export {
  moduleManifestSchema,
  parseModuleManifest,
  type ManifestParseResult,
  type ManifestValidationIssue,
  type ModuleManifest,
  type ModuleManifestMenuEntry,
  type ModuleManifestPermission,
  type ModuleManifestRoute,
  type ModuleManifestSetting,
  type ModuleStatus,
} from './module-manifest';
