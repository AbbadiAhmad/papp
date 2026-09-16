#!/usr/bin/env -S npx tsx
/**
 * scripts/lint-no-hardcoded-roles.ts
 *
 * D12/D46/ARCHITECTURE.md §7.4: every action is permission-gated by a
 * permission CODE, never a hardcoded role name — with exactly one sanctioned
 * exception in the whole codebase (the Permissions page always being
 * reachable by `admin`), living in exactly one file:
 * `apps/api/src/core/permissions/permissions-page.guard.ts`.
 *
 * This script is the CI backstop for that rule (the file's own doc-comment
 * is the primary defense — see docs/BUILD_PLAN.md risk #2): it greps every
 * non-test `.ts` file under `apps/api/src` for role-name-shaped checks and
 * fails, listing file+line, for any match outside the one allowed file.
 *
 * Patterns matched (docs/BUILD_PLAN.md Phase 7 task description):
 *   1. A base-role string literal ('admin' | 'reader' | 'finance' |
 *      'library_assistant') compared with ===/!==/==/!=.
 *   2. `.includes('<role literal>')` (either quote style).
 *   3. `case '<role literal>':` in a switch statement.
 *   4. `role.code` compared with ===/!==/==/!= (any RHS — a comparison
 *      against a role's code at all is the smell, regardless of literal).
 *   5. `.roles.includes(` (a raw roles-array membership check, the shape
 *      the D12 doc-comment calls out as the other half of "the one
 *      sanctioned exception").
 *
 * Comments are stripped before matching (block `/* *\/` and line `//`) so
 * this script doesn't flag the many doc-comments in the codebase that
 * quote these exact patterns *as prose* to explain the rule (including
 * permissions-page.guard.ts's own docblock) — matches only count code, not
 * bearing witness to what a comment says its own file's code does.
 */
import { readFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from './lib/walk-files.ts';

export interface HardcodedRoleMatch {
  file: string;
  line: number;
  snippet: string;
  rule: string;
}

const BASE_ROLES = ['admin', 'reader', 'finance', 'library_assistant'];
const ROLE_LITERAL_ALT = BASE_ROLES.join('|');

/**
 * The single sanctioned D12 exception file, relative to the repo root, using
 * POSIX separators so the comparison is platform-independent.
 */
export const SANCTIONED_FILE = 'apps/api/src/core/permissions/permissions-page.guard.ts';

const RULES: { name: string; regex: RegExp }[] = [
  {
    name: 'role-literal-comparison',
    regex: new RegExp(`(===|!==|==|!=)\\s*(['"])(${ROLE_LITERAL_ALT})\\2|(['"])(${ROLE_LITERAL_ALT})\\4\\s*(===|!==|==|!=)`, 'g'),
  },
  {
    name: 'role-literal-includes',
    regex: new RegExp(`\\.includes\\(\\s*(['"])(${ROLE_LITERAL_ALT})\\1\\s*\\)`, 'g'),
  },
  {
    name: 'role-literal-switch-case',
    regex: new RegExp(`\\bcase\\s*(['"])(${ROLE_LITERAL_ALT})\\1\\s*:`, 'g'),
  },
  {
    name: 'role-code-comparison',
    regex: /\brole\.code\s*(===|!==|==|!=)/g,
  },
  {
    name: 'roles-array-includes',
    regex: /\.roles\.includes\(/g,
  },
];

/** Strips `/* ... *\/` block comments and `// ...` line comments from TS source (see file docblock for why). */
export function stripComments(source: string): string {
  let noBlocks = '';
  let inBlock = false;
  for (let i = 0; i < source.length; i++) {
    if (!inBlock && source[i] === '/' && source[i + 1] === '*') {
      inBlock = true;
      noBlocks += '  ';
      i++;
      continue;
    }
    if (inBlock) {
      if (source[i] === '*' && source[i + 1] === '/') {
        inBlock = false;
        noBlocks += '  ';
        i++;
      } else {
        noBlocks += source[i] === '\n' ? '\n' : ' ';
      }
      continue;
    }
    noBlocks += source[i];
  }

  // Line comments: strip from the first `//` on a line that isn't inside a
  // quoted string, using a simple running-quote-state scan per line (good
  // enough for this codebase's Prettier-formatted, ASCII-quote style).
  return noBlocks
    .split('\n')
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
          if (ch === '\\') {
            i++;
          } else if (ch === quote) {
            quote = null;
          }
          continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
          quote = ch;
          continue;
        }
        if (ch === '/' && line[i + 1] === '/') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

export interface LintNoHardcodedRolesOptions {
  repoRoot: string;
}

export interface LintNoHardcodedRolesResult {
  filesScanned: number;
  matches: HardcodedRoleMatch[];
  /** Matches outside the one sanctioned file — the real failures. */
  violations: HardcodedRoleMatch[];
}

function isTestFile(path: string): boolean {
  return /\.(spec|integration-spec|e2e-spec)\.ts$/.test(path);
}

export function lintNoHardcodedRoles(options: LintNoHardcodedRolesOptions): LintNoHardcodedRolesResult {
  const { repoRoot } = options;
  const srcDir = join(repoRoot, 'apps/api/src');
  const files = walkFiles(srcDir, (path) => path.endsWith('.ts') && !isTestFile(path));

  const matches: HardcodedRoleMatch[] = [];
  for (const file of files) {
    const relPath = relative(repoRoot, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    const cleaned = stripComments(source);
    const lines = cleaned.split('\n');

    for (const rule of RULES) {
      lines.forEach((lineText, idx) => {
        rule.regex.lastIndex = 0;
        if (rule.regex.test(lineText)) {
          matches.push({ file: relPath, line: idx + 1, snippet: lineText.trim(), rule: rule.name });
        }
      });
    }
  }

  const violations = matches.filter((m) => m.file !== SANCTIONED_FILE);

  return { filesScanned: files.length, matches, violations };
}

function main(): void {
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const result = lintNoHardcodedRoles({ repoRoot });

  console.log(
    `lint-no-hardcoded-roles: scanned ${result.filesScanned} file(s) under apps/api/src ` +
      `(excluding test files); ${result.matches.length} role-check-shaped match(es) found in total ` +
      `(sanctioned file: ${SANCTIONED_FILE}).`,
  );

  if (result.violations.length > 0) {
    console.error('\nlint-no-hardcoded-roles: FAILED — hardcoded role-name check(s) found outside the sanctioned D12 file:\n');
    for (const v of result.violations) {
      console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.snippet}`);
    }
    console.error(
      `\nOnly ${SANCTIONED_FILE} may contain a role-name-shaped check (docs/DECISIONS.md D12). ` +
        'Grant the permission by default in a seed migration instead of hardcoding a role check.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('lint-no-hardcoded-roles: OK — no unsanctioned hardcoded role checks found.');
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  main();
}
