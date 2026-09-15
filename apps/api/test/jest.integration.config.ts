import type { Config } from 'jest';
import { baseConfig } from './jest.base.config.ts';

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
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
};

export default config;
