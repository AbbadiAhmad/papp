import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Uploaded files (book covers and book files, survey pictures, ...) live in directories OUTSIDE the
 * database, so the database backup does not contain them. `BACKUP_FILE_DIRS` names those directories:
 * `books_files=/data/books_files,survey_media=/data/survey-media`. A module that stores files tells the
 * operator to add its directory here; core never learns module names — it only archives what is listed.
 * Framework-free so the export (BackupService) and the restore (cli-db.ts) share exactly one parser.
 */

export interface FileRoot {
  name: string;
  dir: string;
}

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const FILES_MEMBER_PREFIX = 'files/';
export const FILES_METADATA_MEMBER = 'files-metadata.json';

export function parseFileRoots(value: string | undefined): FileRoot[] {
  const roots: FileRoot[] = [];
  for (const part of (value ?? '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const name = eq > 0 ? trimmed.slice(0, eq).trim() : '';
    const dir = eq > 0 ? trimmed.slice(eq + 1).trim() : '';
    if (!NAME_RE.test(name) || !isAbsolute(dir) || roots.some((r) => r.name === name)) continue;
    roots.push({ name, dir: resolve(dir) });
  }
  return roots;
}

/** Every regular file under `dir`, as paths relative to it (forward slashes). Missing directory = empty. Symlinks are skipped. */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && statSync(full).isFile()) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Where an archive member `files/<root>/<relative path>` must be written, or null when it is not
 * safe/known (unknown root, `..`, absolute path, empty). The result is always inside the root.
 */
export function resolveRestoreTarget(memberName: string, roots: FileRoot[]): string | null {
  if (!memberName.startsWith(FILES_MEMBER_PREFIX)) return null;
  const rest = memberName.slice(FILES_MEMBER_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const root = roots.find((r) => r.name === rest.slice(0, slash));
  const rel = rest.slice(slash + 1);
  if (!root || !rel || rel.includes('\0') || rel.includes('\\') || isAbsolute(rel)) return null;
  const target = resolve(root.dir, rel);
  return target.startsWith(root.dir + sep) ? target : null;
}
