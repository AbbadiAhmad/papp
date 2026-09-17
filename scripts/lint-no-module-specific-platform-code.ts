#!/usr/bin/env -S npx tsx
/**
 * scripts/lint-no-module-specific-platform-code.ts
 *
 * Root DECISIONS.md D78: "installing/uninstalling a module changes no
 * platform file" is a real, load-bearing property of this codebase, not
 * just an aspiration — this script is its CI-enforced guard, matching the
 * `lint-permissions`/`lint-locales`/`lint-no-hardcoded-roles` family.
 *
 * The concrete, checkable rule: no file under `apps/api/src/**` or
 * `apps/web/src/**` may contain an import/require/dynamic-import specifier
 * that names a SPECIFIC, real module directory (`modules/<key>/...` for any
 * `<key>` that actually exists on disk under `modules/`). A generic,
 * wildcard-based mechanism (`import(...)` with a runtime-computed path,
 * Vite's `import.meta.glob('modules/*\/...')`) is exactly what §9.4/D78's
 * generic loader is built from and never matches this rule — only a
 * LITERAL module key inside an import path is a violation, because that is
 * platform code that would have to be edited to add/remove that one module.
 *
 * Deliberately narrower than a bare substring/word search: `template` and
 * `website` are both common English words that show up harmlessly in
 * comments/prose all over this codebase (e.g. "email template", website
 * URLs) — flagging those would be noise, not signal. An import PATH
 * containing `modules/<key>/` is the actual coupling this rule cares about,
 * and it's a precise, false-positive-free signal.
 */
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lint-no-hardcoded-roles.ts';
import { listSubdirectories, walkFiles } from './lib/walk-files.ts';

export interface ModuleSpecificMatch {
  file: string;
  line: number;
  snippet: string;
  moduleKey: string;
}

export interface LintNoModuleSpecificPlatformCodeOptions {
  repoRoot: string;
}

export interface LintNoModuleSpecificPlatformCodeResult {
  moduleKeys: string[];
  filesScanned: number;
  violations: ModuleSpecificMatch[];
}

const SCAN_ROOTS = ['apps/api/src', 'apps/web/src'];

function isTestFile(path: string): boolean {
  return /\.(spec|integration-spec|e2e-spec|test)\.tsx?$/.test(path);
}

/** Matches an import/require/dynamic-import string literal containing `modules/<key>/`. */
function buildModulePathPattern(moduleKey: string): RegExp {
  // Matches the key preceded by "modules/" and followed by "/", inside a
  // quoted string — covers `from '...modules/key/...'`, `import('...')`,
  // and `require('...')` alike, any quote style, any relative-path depth.
  return new RegExp(`modules/${moduleKey}/`, 'g');
}

export function lintNoModuleSpecificPlatformCode(
  options: LintNoModuleSpecificPlatformCodeOptions,
): LintNoModuleSpecificPlatformCodeResult {
  const { repoRoot } = options;
  const moduleKeys = listSubdirectories(resolve(repoRoot, 'modules'));

  const files = SCAN_ROOTS.flatMap((root) =>
    walkFiles(resolve(repoRoot, root), (path) => /\.tsx?$/.test(path) && !isTestFile(path)),
  );

  const violations: ModuleSpecificMatch[] = [];
  for (const file of files) {
    const relPath = relative(repoRoot, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    // Comments legitimately reference a module by path as PROSE (e.g. "see
    // modules/website/DOCUMENTATION.md") — strip them first (same helper
    // lint-no-hardcoded-roles.ts uses) so only real import/require code is
    // ever matched, never documentation quoting an example.
    const lines = stripComments(source).split('\n');

    for (const moduleKey of moduleKeys) {
      const pattern = buildModulePathPattern(moduleKey);
      lines.forEach((lineText, idx) => {
        pattern.lastIndex = 0;
        if (pattern.test(lineText)) {
          violations.push({ file: relPath, line: idx + 1, snippet: lineText.trim(), moduleKey });
        }
      });
    }
  }

  return { moduleKeys, filesScanned: files.length, violations };
}

function main(): void {
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const result = lintNoModuleSpecificPlatformCode({ repoRoot });

  console.log(
    `lint-no-module-specific-platform-code: scanned ${result.filesScanned} file(s) under ${SCAN_ROOTS.join(', ')} ` +
      `against ${result.moduleKeys.length} real module key(s) (${result.moduleKeys.join(', ') || 'none'}).`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nlint-no-module-specific-platform-code: FAILED — platform code references a specific module by path:\n',
    );
    for (const v of result.violations) {
      console.error(`  ${v.file}:${v.line}  [module: ${v.moduleKey}]  ${v.snippet}`);
    }
    console.error(
      '\nPlatform code (apps/api/src/**, apps/web/src/**) must never import a specific module directory ' +
        '(root DECISIONS.md D78) — route through the generic mechanisms instead: backend module-loader.ts\'s ' +
        'dynamic import from module_registry, or frontend shared/modules/discovery.ts\'s import.meta.glob.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('lint-no-module-specific-platform-code: OK — no platform file names a specific module by path.');
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  main();
}
