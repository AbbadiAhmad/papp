import type { Config } from 'jest';
import { baseConfig, modulesRoot } from './jest.base.config.ts';

/**
 * Backend integration layer (docs/TESTING_STRATEGY.md §1): real PostgreSQL
 * via Testcontainers (see test/support/postgres-test-container.ts) —
 * migrations actually applying, module install/upgrade flow. Each spec file
 * starts/stops its own throwaway Postgres 16 container in beforeAll/afterAll.
 *
 * maxWorkers: 1 — these specs are container-heavy and, at this phase, share
 * the pattern of running serially rather than racing multiple Postgres
 * containers against the sandbox's Docker daemon at once.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'integration',
  // Root DECISIONS.md D76: module-owned integration specs (none exist yet)
  // would live at `modules/<key>/test/backend/*.integration-spec.ts`.
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts', `${modulesRoot}/*/test/backend/*.integration-spec.ts`],
  testTimeout: 120_000,
  maxWorkers: 1,
  // Same fix as jest.unit.config.ts's "Known Tier 1 gotcha #2" (see
  // jest.e2e.config.ts's identical comment) — a dual-shipped module's
  // extensionless imports must resolve to `.ts` source, not its committed
  // `.js` build output.
  moduleFileExtensions: ['ts', 'js', 'json'],
};

export default config;
