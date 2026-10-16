import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '../../locales/ar.json';
import en from '../../locales/en.json';

/**
 * docs/TESTING_STRATEGY.md §5: a string shown to a user must exist in BOTH languages. `lint:locales` proves `ar` and
 * `en` have the same keys; this proves the keys the screens actually ask for (`t('…')` with a literal key) exist
 * at all, so a typo or a forgotten key cannot ship as a raw key name on screen. Template-string keys are skipped.
 */
const root = join(__dirname, '../../frontend');
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(tsx|ts)$/.test(name)) files.push(full);
  }
};
walk(root);

const used = new Map<string, string>();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*'(survey[a-z_]*\.[A-Za-z0-9_.]+)'/g)) used.set(match[1], file.replace(root, 'frontend'));
}

describe('survey locale keys used by the screens', () => {
  it('finds a meaningful number of keys (guards the scan itself)', () => {
    expect(used.size).toBeGreaterThan(40);
  });
  it('every literal key exists in en.json', () => {
    const missing = [...used].filter(([key]) => !(key in en)).map(([key, file]) => key + ' (' + file + ')');
    expect(missing).toEqual([]);
  });
  it('every literal key exists in ar.json', () => {
    const missing = [...used].filter(([key]) => !(key in ar)).map(([key, file]) => key + ' (' + file + ')');
    expect(missing).toEqual([]);
  });
});
