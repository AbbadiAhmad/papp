import type { Config } from 'jest';
import { fileURLToPath } from 'node:url';

/**
 * Shared Jest settings for all three test layers (unit/integration/e2e).
 * Not one of the "Tester builds" files named in docs/BUILD_PLAN.md Phase 0,
 * but factoring the common bits out keeps jest.unit/integration/e2e.config.ts
 * from drifting out of sync with each other as the test suite grows.
 *
 * Jest 30 loads `.ts` config files as native ESM (see the three
 * jest.*.config.ts files importing this one with an explicit `.ts`
 * extension), so this uses `import.meta.url` rather than the CommonJS
 * `__dirname` the rest of the app's TS (compiled with `module: commonjs`)
 * uses.
 */
export const rootDir = fileURLToPath(new URL('..', import.meta.url));

export const baseConfig: Config = {
  rootDir,
  testEnvironment: 'node',
  // NestJS 12's packages (@nestjs/common, @nestjs/core, ...) ship as
  // ESM-only (`"type": "module"`, no CJS build) — see the ExecException
  // this replaced ("Must use import to load ES Module ... @nestjs/common")
  // for the exact failure. Jest can only `require()` an ESM dependency
  // without extra config on Node 24.9+; this sandbox/CI run on an older
  // Node, so tests are compiled to real ESM instead (`useESM`) and run
  // with `NODE_OPTIONS=--experimental-vm-modules` (see the test:* scripts
  // in apps/api/package.json).
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.esm.json', useESM: true }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^@papp/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@papp/shared-types/(.*)$': '<rootDir>/../../packages/shared-types/src/$1',
  },
  clearMocks: true,
  // Phase 0 has no business logic yet (see BUILD_PLAN.md Phase 0 "Done when"),
  // so an empty test layer must pass, not fail the build.
  passWithNoTests: true,
};
