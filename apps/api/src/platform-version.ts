/**
 * The base platform's own version, checked against every module manifest's
 * `compatibleAppVersion` semver RANGE at install/upgrade time
 * (MODULE_SPEC.md §4 step 2). Bumped by hand when the platform's
 * module-facing surface changes in a way modules can be incompatible with.
 *
 * Distinct from `CORE_MODULE_VERSION` in main.ts (the core pseudo-module's
 * migration-set marker) and from package.json versions (npm bookkeeping) —
 * this is the ONE number module authors write ranges against.
 */
export const PLATFORM_VERSION = '0.1.0';
