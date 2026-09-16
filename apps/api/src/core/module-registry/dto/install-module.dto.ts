import { Matches } from 'class-validator';

/**
 * No upload mechanism exists yet (MODULE_SPEC.md §4 step 1 note) — the
 * simplest correct approach for now is that the admin names a module already
 * present under `modules/<key>/` (or wherever `MODULES_DIR` points) in the
 * deployed image, and the service reads `modules/<key>/manifest.json` itself.
 */
export class InstallModuleDto {
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'key must be a snake_case module key (matching modules/<key>/)' })
  key!: string;
}
