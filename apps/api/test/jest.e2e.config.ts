import type { Config } from 'jest';
import { baseConfig, modulesRoot } from './jest.base.config.ts';

/**
 * Backend e2e layer (docs/TESTING_STRATEGY.md §1): boots the real Nest app
 * with Supertest against a throwaway Postgres (Testcontainers) — full HTTP
 * request -> guard -> controller -> DB round trip, per endpoint.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'e2e',
  // Root DECISIONS.md D76: module-owned e2e specs live at
  // `modules/<key>/test/backend/*.e2e-spec.ts`.
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts', `${modulesRoot}/*/test/backend/*.e2e-spec.ts`],
  testTimeout: 120_000,
  maxWorkers: 1,
  // Same fix as jest.unit.config.ts's "Known Tier 1 gotcha #2"
  // (docs/TESTING_STRATEGY.md): any spec that loads a dual-shipped module's
  // source (e.g. library_catalog, which ships both backend/*.ts and its own
  // pre-compiled backend/*.js per MODULE_SPEC.md §1/D56) must resolve `.ts`
  // first, or Jest's default extension order silently redirects to the
  // committed CommonJS build output, which fails under this ESM-only
  // runtime regardless of Docker/DB availability.
  moduleFileExtensions: ['ts', 'js', 'json'],
  // "Known Tier 1 gotcha #3" (docs/TESTING_STRATEGY.md, D59): modules/library_catalog's
  // public.controller.ts deliberately imports the REAL `PublicThrottlerGuard`
  // from apps/api's BUILT output (`apps/api/dist/...`, per D57 — it's genuine
  // shared rate-limiter logic, not a metadata-marker shim). That dist file is
  // tsc-compiled CommonJS (`require('@nestjs/common')`), which jest-runtime's
  // own CJS `require()` cannot load — @nestjs/common 12 ships ESM-only, and
  // jest-runtime only gained `require(esm)` support on Node 24.9+ (this
  // repo/CI target Node 22 — see jest.base.config.ts's docblock for the same
  // Node-version boundary). Every other `.ts` import of NestJS packages in
  // this suite avoids that failure entirely because ts-jest compiles `.ts` to
  // real ESM (`useESM: true`) and Jest's `--experimental-vm-modules` loader
  // uses Node's native ESM resolver for those, which has no such version
  // floor. This is a TEST-ONLY redirect (mirrors the existing
  // `@papp/shared-types` -> TS-source `moduleNameMapper` entry in
  // jest.base.config.ts, same rationale): it points this one specifier at the
  // exact `.ts` source AppModule itself already loads elsewhere in the same
  // test run (so Jest's module cache gives every test exactly one guard
  // class, not two), leaving the real dist import untouched for actual
  // dev/production processes, which run on real Node (22.12+) with native
  // require(esm) support and never hit this at all.
  moduleNameMapper: {
    ...baseConfig.moduleNameMapper,
    // Redirect dist imports to TypeScript source to avoid CJS/ESM loading
    // issues when CommonJS-compiled modules try to import ESM-only packages
    // (like @nestjs/common). This is only needed for e2e tests that load the
    // compiled dist output; actual dev/production use the real CommonJS output
    // on Node 22.12+ which has native require(esm) support.
    '^.*/apps/api/dist/common/guards/public-throttler\\.guard$':
      '<rootDir>/src/common/guards/public-throttler.guard.ts',
    '^.*/apps/api/dist/core/notifications/notifications\\.module$':
      '<rootDir>/src/core/notifications/notifications.module.ts',
    '^.*/apps/api/dist/core/notifications/notifications\\.service$':
      '<rootDir>/src/core/notifications/notifications.service.ts',
    '^.*/apps/api/dist/core/notifications/notification-email\\.service$':
      '<rootDir>/src/core/notifications/notification-email.service.ts',
    // library_circulation binds core's PermissionsService to its PERMISSION_CHECKER token (the return form's
    // "paid now" needs a second permission check) — same dist -> source redirect as the notifications entries above.
    '^.*/apps/api/dist/core/permissions/permissions\\.service$':
      '<rootDir>/src/core/permissions/permissions.service.ts',
  },
};

export default config;
