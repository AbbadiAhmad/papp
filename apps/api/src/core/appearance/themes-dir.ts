import { join, resolve } from 'node:path';

/**
 * Where installable theme packs live: `<repo root>/themes/<key>/theme.json`.
 * Overridable via THEMES_DIR (tests, or a deployment mounting themes
 * elsewhere). Same depth trick as `resolveModulesDir()`. A missing
 * directory means "no installable themes", never an error.
 */
export function resolveThemesDir(): string {
  if (process.env.THEMES_DIR) {
    return resolve(process.env.THEMES_DIR);
  }
  return join(__dirname, '..', '..', '..', '..', '..', 'themes');
}
