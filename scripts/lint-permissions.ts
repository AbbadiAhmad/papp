#!/usr/bin/env -S npx tsx
/**
 * scripts/lint-permissions.ts
 *
 * Cross-checks every `@RequirePermission('code')` usage in a controller
 * against the actual seeded permission catalog, so a permission code can
 * never be enforced by a guard without also existing in the catalog an
 * admin grants roles from.
 *
 * Current scope (docs/BUILD_PLAN.md Phase 7 / TESTING_STRATEGY.md §8): no
 * real installable module exists yet (Phase 8 builds the first one under
 * `modules/`), so every controller found under `apps/api/src/**` is, by
 * construction, a CORE controller — core permissions are seeded the same
 * way a module would seed its own, via `INSERT INTO permissions` statements
 * in `apps/api/src/core/migrations/*.sql` (see docs/DECISIONS.md D46: each
 * phase's migration seeds only the codes whose enforcement points exist).
 *
 * The check: every `@RequirePermission` code found in a core controller
 * must appear as a seeded permission code somewhere in those migration
 * files. Fails with a clear listing of any code used but never seeded.
 *
 * TODO (Phase 8+): once `modules/<key>/manifest.json` files exist (per
 * docs/MODULE_SPEC.md §1/§2), extend this script with a second check: every
 * `@RequirePermission` code used inside `modules/<key>/backend/**` must
 * appear in that module's own `manifest.json` `permissions` array (not the
 * core migrations). Not built now — there is no module to verify this
 * against yet, and inventing a fixture for a mechanism with zero real
 * consumers would be speculative scope creep for this phase.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from './lib/walk-files.ts';

export interface PermissionUsage {
  code: string;
  file: string;
  line: number;
}

export interface LintPermissionsResult {
  /** Every `@RequirePermission('code')` usage found in a core controller. */
  usages: PermissionUsage[];
  /** Every permission code seeded via `INSERT INTO permissions` in core migrations. */
  seededCodes: Set<string>;
  /** Usages whose code was never seeded — the actual failures. */
  undeclared: PermissionUsage[];
}

const REQUIRE_PERMISSION_RE = /@RequirePermission\(\s*['"]([a-zA-Z0-9_.]+)['"]\s*\)/g;

/** Finds every `@RequirePermission('code')` usage in one controller file's source. */
export function extractRequirePermissionUsages(filePath: string, source: string): PermissionUsage[] {
  const usages: PermissionUsage[] = [];
  const lines = source.split('\n');
  lines.forEach((lineText, idx) => {
    REQUIRE_PERMISSION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REQUIRE_PERMISSION_RE.exec(lineText)) !== null) {
      usages.push({ code: match[1], file: filePath, line: idx + 1 });
    }
  });
  return usages;
}

/**
 * Extracts every permission code registered via an
 * `INSERT INTO permissions (code, ...) VALUES (...), (...), ...;` statement
 * in one migration file's raw SQL text. Tolerant of whitespace/comments
 * between rows (this codebase's migrations are hand-formatted, aligned
 * with extra spaces for readability).
 */
export function extractSeededPermissionCodes(sqlSource: string): string[] {
  const codes: string[] = [];
  const insertBlockRe = /INSERT\s+INTO\s+permissions\s*\([^)]*\)\s*VALUES\s*([\s\S]*?);/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = insertBlockRe.exec(sqlSource)) !== null) {
    const valuesBlock = blockMatch[1];
    // Each row is `('code', 'module_key', 'category', 'i18n_key')` — the
    // permission code is always the first quoted literal in the tuple.
    const rowRe = /\(\s*'([a-zA-Z0-9_.]+)'/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(valuesBlock)) !== null) {
      codes.push(rowMatch[1]);
    }
  }
  return codes;
}

export interface LintPermissionsOptions {
  /** Repo root containing `apps/`. */
  repoRoot: string;
}

export function lintPermissions(options: LintPermissionsOptions): LintPermissionsResult {
  const { repoRoot } = options;
  const controllersDir = join(repoRoot, 'apps/api/src');
  const migrationsDir = join(repoRoot, 'apps/api/src/core/migrations');

  const controllerFiles = walkFiles(controllersDir, (path) => path.endsWith('.controller.ts'));
  const usages: PermissionUsage[] = [];
  for (const file of controllerFiles) {
    const source = readFileSync(file, 'utf8');
    usages.push(...extractRequirePermissionUsages(file, source));
  }

  const migrationFiles = walkFiles(migrationsDir, (path) => path.endsWith('.sql'));
  const seededCodes = new Set<string>();
  for (const file of migrationFiles) {
    const source = readFileSync(file, 'utf8');
    for (const code of extractSeededPermissionCodes(source)) {
      seededCodes.add(code);
    }
  }

  const undeclared = usages.filter((usage) => !seededCodes.has(usage.code));

  return { usages, seededCodes, undeclared };
}

function main(): void {
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const result = lintPermissions({ repoRoot });

  console.log(
    `lint-permissions: ${result.usages.length} @RequirePermission usage(s) found across core controllers, ` +
      `${result.seededCodes.size} distinct permission code(s) seeded in apps/api/src/core/migrations/*.sql.`,
  );

  if (result.undeclared.length > 0) {
    console.error('\nlint-permissions: FAILED — permission code(s) used but never seeded:\n');
    for (const usage of result.undeclared) {
      console.error(`  ${usage.file}:${usage.line}  @RequirePermission('${usage.code}')`);
    }
    console.error(
      '\nEvery @RequirePermission code must appear in an `INSERT INTO permissions` statement under ' +
        'apps/api/src/core/migrations/*.sql before it can be enforced by a guard.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('lint-permissions: OK — every @RequirePermission code is seeded.');
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  main();
}
