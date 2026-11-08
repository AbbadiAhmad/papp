import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Modules cannot import apps/api's built output from a unit test (root D126), so each keeps an identical copy of the
 * shared Excel helper. This keeps the copies from drifting: edit apps/api/src/common/excel/xlsx-io.ts, then copy it over.
 */
describe('xlsx-io copies', () => {
  const repo = join(process.cwd(), '..', '..'); // jest runs from apps/api
  const canonical = readFileSync(join(repo, 'apps/api/src/common/excel/xlsx-io.ts'), 'utf8');

  it.each(['library_catalog', 'library_circulation', 'survey'])('modules/%s/backend/xlsx-io.ts is identical to the core file', (key) => {
    expect(readFileSync(join(repo, 'modules', key, 'backend', 'xlsx-io.ts'), 'utf8')).toBe(canonical);
  });
});
