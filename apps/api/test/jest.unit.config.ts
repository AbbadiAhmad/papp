import type { Config } from 'jest';
import { baseConfig } from './jest.base.config.ts';

/**
 * Backend unit layer (docs/TESTING_STRATEGY.md §1): pure logic, no DB, no
 * HTTP — services/guards/interceptors in isolation. Naming convention:
 * `*.spec.ts`, deliberately not matching `*.integration-spec.ts` or
 * `*.e2e-spec.ts` (those end in `-spec.ts`, not `.spec.ts`).
 */
const config: Config = {
  ...baseConfig,
  displayName: 'unit',
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/src/**/*.spec.ts'],
};

export default config;
