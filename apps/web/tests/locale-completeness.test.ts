import { describe, expect, it } from 'vitest';
import ar from '../src/locales/core/ar.json';
import en from '../src/locales/core/en.json';

/**
 * docs/TESTING_STRATEGY.md §5 / CLAUDE.md rule 3: every key in a module's
 * `en.json` must also exist in `ar.json` and vice versa — catches "shipped
 * without Arabic" and "forgot to translate the new key" both. This is the
 * component-level version of the same check Phase 7's CI script will run
 * over every module's locale pair; this one covers `locales/core`.
 *
 * Recursive (not just flat-key) on purpose: today's `core` locale files
 * happen to be flat, dot-separated key files, but this check must not
 * silently stop covering nested locale JSON if a future module ships one.
 */
function collectKeyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('locales/core: ar/en key parity', () => {
  const arKeys = new Set(collectKeyPaths(ar));
  const enKeys = new Set(collectKeyPaths(en));

  it('every ar.json key exists in en.json', () => {
    const missingInEn = [...arKeys].filter((key) => !enKeys.has(key)).sort();
    expect(missingInEn).toEqual([]);
  });

  it('every en.json key exists in ar.json', () => {
    const missingInAr = [...enKeys].filter((key) => !arKeys.has(key)).sort();
    expect(missingInAr).toEqual([]);
  });

  it('neither locale file is empty (a trivially "passing" parity check is not a real check)', () => {
    expect(arKeys.size).toBeGreaterThan(0);
    expect(enKeys.size).toBeGreaterThan(0);
  });

  it('every value is a non-empty string (no accidentally-empty translation)', () => {
    const emptyArValues = Object.entries(ar as Record<string, unknown>).filter(
      ([, value]) => typeof value !== 'string' || value.trim() === '',
    );
    const emptyEnValues = Object.entries(en as Record<string, unknown>).filter(
      ([, value]) => typeof value !== 'string' || value.trim() === '',
    );
    expect(emptyArValues).toEqual([]);
    expect(emptyEnValues).toEqual([]);
  });

  it('every {{placeholder}} used in an ar string is also present in the matching en string and vice versa', () => {
    const placeholderPattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    const extractPlaceholders = (value: string) => [...value.matchAll(placeholderPattern)].map((m) => m[1]).sort();

    const mismatches: string[] = [];
    for (const key of arKeys) {
      const arValue = (ar as Record<string, string>)[key];
      const enValue = (en as Record<string, string>)[key];
      if (typeof arValue !== 'string' || typeof enValue !== 'string') continue;
      const arPlaceholders = extractPlaceholders(arValue);
      const enPlaceholders = extractPlaceholders(enValue);
      if (JSON.stringify(arPlaceholders) !== JSON.stringify(enPlaceholders)) {
        mismatches.push(key);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
