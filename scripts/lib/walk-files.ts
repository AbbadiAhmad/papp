/**
 * scripts/lib/walk-files.ts — tiny shared file-walker for the CI static
 * analysis scripts (lint-permissions/lint-locales/lint-no-hardcoded-roles).
 *
 * Deliberately dependency-free (no `glob`/`fast-glob`): Node 20+'s
 * `fs.readdirSync(dir, { recursive: true, withFileTypes: true })` plus each
 * dirent's `parentPath` is enough for this repo's narrow, well-known
 * directory shapes, and keeps these CI scripts free of an extra
 * supply-chain dependency for something this small.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recursively lists every file under `dir` whose full path satisfies
 * `predicate`. Returns an empty array (not an error) when `dir` doesn't
 * exist yet — several call sites scan directories that only start existing
 * once a later phase (e.g. `modules/`) adds real content.
 */
export function walkFiles(dir: string, predicate: (path: string) => boolean): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parentPath = (entry as { parentPath?: string; path?: string }).parentPath ?? (entry as { path?: string }).path;
    if (!parentPath) continue;
    const fullPath = join(parentPath, entry.name);
    if (predicate(fullPath)) {
      matches.push(fullPath);
    }
  }
  return matches;
}

/** Lists the immediate subdirectory names of `dir` (non-recursive), or `[]` if `dir` doesn't exist. */
export function listSubdirectories(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
