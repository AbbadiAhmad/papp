import { join, resolve } from 'node:path';

/**
 * Where installable module packages live: `<repo root>/modules/<key>/`
 * (MODULE_SPEC.md §1). Overridable via the MODULES_DIR env var (used by
 * integration tests and by any deployment that mounts modules elsewhere).
 *
 * The default is resolved relative to THIS file, which sits at the same
 * depth in both the TS source tree (apps/api/src/core/module-registry/) and
 * the build output (apps/api/dist/core/module-registry/) — five levels up is
 * the repo root either way. The directory may not exist yet (no modules are
 * shipped until Phase 8); every consumer must treat a missing directory as
 * "zero modules", never as an error.
 */
export function resolveModulesDir(): string {
  if (process.env.MODULES_DIR) {
    return resolve(process.env.MODULES_DIR);
  }
  return join(__dirname, '..', '..', '..', '..', '..', 'modules');
}
