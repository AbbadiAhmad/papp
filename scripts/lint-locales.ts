#!/usr/bin/env -S npx tsx
/**
 * scripts/lint-locales.ts
 *
 * D19/CLAUDE.md rule 3: every module ships its own `ar` + confirmed-language
 * locale files, and a module without Arabic strings fails install
 * validation. This script is the CI-time backstop for the same idea applied
 * to key-level completeness: for every known `{ar, en}.json` locale-file
 * pair in the repo, the two files' key sets must match exactly. A key
 * present in one language and missing in the other is exactly the
 * "shipped without Arabic" / "forgot to translate the new key" bug
 * docs/TESTING_STRATEGY.md §5 calls out.
 *
 * Pairs checked today (docs/CHECKLIST.md item 4: confirmed languages are
 * ar + en only, D28):
 *   - apps/api/src/core/i18n/locales/{ar,en}.json   (backend-owned core keys)
 *   - apps/web/src/locales/core/{ar,en}.json         (frontend-owned core keys)
 *   - modules/*\/locales/{ar,en}.json                (per docs/MODULE_SPEC.md
 *     §1) — none exist yet (no module is installed until Phase 8), so this
 *     glob simply contributes zero pairs for now; the script does not
 *     invent a fixture pair to check against nothing.
 *
 * Note: Notification templates (D22) are deliberately EXCLUDED — they are
 * operator-authored freeform Markdown content rows in `system_settings`,
 * not developer i18n keys, so they have no `ar`/`en` file pair to compare.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSubdirectories } from './lib/walk-files.ts';

export interface LocalePair {
  /** Human-readable label for reporting, e.g. "apps/api core". */
  label: string;
  arPath: string;
  enPath: string;
}

export interface LocalePairResult {
  pair: LocalePair;
  /** Keys present in ar.json but missing from en.json. */
  missingInEn: string[];
  /** Keys present in en.json but missing from ar.json. */
  missingInAr: string[];
}

export interface LintLocalesResult {
  pairsChecked: LocalePair[];
  failures: LocalePairResult[];
}

/** Recursively flattens a nested JSON object into dot-joined leaf-key paths. */
export function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    keys.push(...flattenKeys(child, childPrefix));
  }
  return keys;
}

/** Compares one ar/en locale-file pair; returns the diff either way (empty arrays = match). */
export function compareLocalePair(pair: LocalePair): LocalePairResult {
  const ar = JSON.parse(readFileSync(pair.arPath, 'utf8')) as unknown;
  const en = JSON.parse(readFileSync(pair.enPath, 'utf8')) as unknown;
  const arKeys = new Set(flattenKeys(ar));
  const enKeys = new Set(flattenKeys(en));

  const missingInEn = [...arKeys].filter((k) => !enKeys.has(k)).sort();
  const missingInAr = [...enKeys].filter((k) => !arKeys.has(k)).sort();

  return { pair, missingInEn, missingInAr };
}

/**
 * Discovers every `modules/<key>/locales/{ar,en}.json` pair per
 * docs/MODULE_SPEC.md §1. Returns `[]` today since `modules/` has no
 * installed module yet — kept as real, exercised code (not a stub) so it
 * "just works" the moment Phase 8 adds the first module.
 */
export function discoverModuleLocalePairs(repoRoot: string): LocalePair[] {
  const modulesDir = join(repoRoot, 'modules');
  const pairs: LocalePair[] = [];
  for (const moduleKey of listSubdirectories(modulesDir)) {
    const arPath = join(modulesDir, moduleKey, 'locales', 'ar.json');
    const enPath = join(modulesDir, moduleKey, 'locales', 'en.json');
    if (existsSync(arPath) && existsSync(enPath)) {
      pairs.push({ label: `modules/${moduleKey}`, arPath, enPath });
    }
  }
  return pairs;
}

export interface LintLocalesOptions {
  repoRoot: string;
}

export function lintLocales(options: LintLocalesOptions): LintLocalesResult {
  const { repoRoot } = options;

  const pairs: LocalePair[] = [
    {
      label: 'apps/api core (backend i18n)',
      arPath: join(repoRoot, 'apps/api/src/core/i18n/locales/ar.json'),
      enPath: join(repoRoot, 'apps/api/src/core/i18n/locales/en.json'),
    },
    {
      label: 'apps/web core (frontend i18n)',
      arPath: join(repoRoot, 'apps/web/src/locales/core/ar.json'),
      enPath: join(repoRoot, 'apps/web/src/locales/core/en.json'),
    },
    ...discoverModuleLocalePairs(repoRoot),
  ].filter((pair) => existsSync(pair.arPath) && existsSync(pair.enPath));

  const failures = pairs.map(compareLocalePair).filter((r) => r.missingInEn.length > 0 || r.missingInAr.length > 0);

  return { pairsChecked: pairs, failures };
}

function main(): void {
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const result = lintLocales({ repoRoot });

  console.log(
    `lint-locales: checked ${result.pairsChecked.length} ar/en locale-file pair(s): ` +
      result.pairsChecked.map((p) => p.label).join(', '),
  );

  if (result.failures.length > 0) {
    console.error('\nlint-locales: FAILED — key mismatch(es) found:\n');
    for (const failure of result.failures) {
      console.error(`  ${failure.pair.label}:`);
      console.error(`    ${failure.pair.arPath}`);
      console.error(`    ${failure.pair.enPath}`);
      if (failure.missingInEn.length > 0) {
        console.error(`    present in ar.json, missing from en.json (${failure.missingInEn.length}):`);
        for (const key of failure.missingInEn) console.error(`      - ${key}`);
      }
      if (failure.missingInAr.length > 0) {
        console.error(`    present in en.json, missing from ar.json (${failure.missingInAr.length}):`);
        for (const key of failure.missingInAr) console.error(`      - ${key}`);
      }
      console.error('');
    }
    process.exitCode = 1;
    return;
  }

  console.log('lint-locales: OK — every checked pair has matching key sets.');
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  main();
}
