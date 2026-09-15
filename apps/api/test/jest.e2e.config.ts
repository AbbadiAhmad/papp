import type { Config } from 'jest';
import { baseConfig } from './jest.base.config.ts';

/**
 * Backend e2e layer (docs/TESTING_STRATEGY.md §1): boots the real Nest app
 * with Supertest against a throwaway Postgres (Testcontainers) — full HTTP
 * request -> guard -> controller -> DB round trip, per endpoint.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'e2e',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
};

export default config;
