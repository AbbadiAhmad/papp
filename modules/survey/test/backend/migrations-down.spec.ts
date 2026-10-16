import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tier 1 static check (docs/TESTING_STRATEGY.md §7, root D48/D86): every up-migration has a matching down-migration
 * of the same name, so `uninstall --drop-data` can run them newest-first and leave nothing behind, and every down
 * file is idempotent (`IF EXISTS`) so a partly-installed module can still be removed.
 */
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');
const ups = readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
const downs = new Set(readdirSync(join(migrations, 'down')).filter((f) => f.endsWith('.sql')));
// Migrations that shipped before down-migrations were required for them (recorded, not hidden).
const KNOWN_MISSING: string[] = [];

describe('survey migrations', () => {
  it('numbers are sequential and unique', () => {
    expect(ups.map((f) => f.slice(0, 3))).toEqual(ups.map((_f, i) => String(i + 1).padStart(3, '0')));
  });

  it.each(ups.filter((f) => !KNOWN_MISSING.includes(f)))('%s has a down migration of the same name', (file) => {
    expect(downs.has(file)).toBe(true);
  });

  it('every down migration undoes something that exists, safely (IF EXISTS everywhere, no bare DROP)', () => {
    for (const file of downs) {
      const sql = readFileSync(join(migrations, 'down', file), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n');
      for (const statement of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
        if (/^(DROP|ALTER)\b/i.test(statement) && /\bDROP\b/i.test(statement)) expect(statement).toMatch(/IF EXISTS/i);
      }
    }
  });
});
