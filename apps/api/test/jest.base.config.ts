import type { Config } from 'jest';
import { join } from 'node:path';
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

/**
 * `modules/<key>/test/backend/` (root DECISIONS.md D76) — module-owned unit
 * and e2e specs live here, NOT under this project's own `test/`. Jest's
 * `roots` defaults to `[rootDir]` (= apps/api), which would never be walked
 * to discover a spec file living outside it — this entry is what makes
 * `testMatch` patterns pointing at `modules/*\/test/backend/**` (added in
 * jest.unit.config.ts/jest.e2e.config.ts/jest.integration.config.ts) actually
 * reachable at all.
 */
export const modulesRoot = join(rootDir, '..', '..', 'modules');

export const baseConfig: Config = {
  rootDir,
  roots: [rootDir, modulesRoot],
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
    // Phase 4 gotcha (the mirror image of the NestJS one above): sanitize-html
    // is CJS, but its whole HTML-parsing dependency tree (htmlparser2 12 →
    // domhandler/domutils/domelementtype/dom-serializer/entities) ships
    // ESM-ONLY. Node 22.12+ handles that require(esm) natively at app
    // runtime, but jest-runtime's own `require` only supports it on Node
    // 24.9+ — under this sandbox's Node 22 it throws "Must use import to
    // load ES Module: .../htmlparser2/dist/index.js" in any suite whose
    // import graph reaches markdown.util.ts. Fix: let ts-jest downlevel just
    // those packages' JS to CommonJS (allowJs + module: commonjs), enabled by
    // the transformIgnorePatterns exception below.
    '^.+\\.js$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: { allowJs: true, module: 'commonjs', esModuleInterop: true, target: 'es2022' },
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(htmlparser2|domhandler|domutils|domelementtype|dom-serializer|entities)/)',
  ],
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
