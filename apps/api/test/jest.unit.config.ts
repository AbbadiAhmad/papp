import type { Config } from 'jest';
import { baseConfig } from './jest.base.config.ts';

/**
 * Backend unit layer (docs/TESTING_STRATEGY.md §1): pure logic, no DB, no
 * HTTP — services/guards/interceptors in isolation. Naming convention:
 * `*.spec.ts`, deliberately not matching `*.integration-spec.ts` or
 * `*.e2e-spec.ts` (those end in `-spec.ts`, not `.spec.ts`).
 *
 * Coverage gate (docs/TESTING_STRATEGY.md §8, docs/BUILD_PLAN.md Phase 7):
 * 80% lines on the security-critical core — PermissionGuard, AuditInterceptor,
 * AuthModule (auth.service.ts/auth.controller.ts), ModuleRegistryModule
 * (module-registry.service.ts) — deliberately scoped per-file, NOT a blanket
 * global threshold (chasing a number on UI/CRUD code isn't the goal). These
 * settings are inert for a plain `npm run test:unit` (no `--coverage` flag);
 * CI's dedicated coverage step (`npm run test:coverage`) is what actually
 * collects coverage and enforces `coverageThreshold` below. As of Phase 7,
 * `auth.controller.ts` (0% — only exercised by the e2e layer, which needs
 * Testcontainers/Docker per D37) and `module-registry.service.ts` (~71%
 * lines) do NOT meet this bar yet — see this phase's Developer report. The
 * threshold is intentionally left at the real target (not quietly lowered to
 * whatever the current numbers happen to be), so CI honestly reports the gap
 * until Phase 9's hardening pass (or a Tier 1 top-up before it) closes it.
 */
const COVERAGE_GATE_FILES = [
  'src/common/guards/permission.guard.ts',
  'src/common/interceptors/audit.interceptor.ts',
  'src/core/auth/auth.service.ts',
  'src/core/auth/auth.controller.ts',
  'src/core/module-registry/module-registry.service.ts',
];

const config: Config = {
  ...baseConfig,
  displayName: 'unit',
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/src/**/*.spec.ts'],
  // `library_catalog` (Phase 8) ships BOTH `backend/*.ts` source AND its own
  // pre-compiled `backend/*.js` output side by side (MODULE_SPEC.md §1/D56).
  // `baseConfig`'s default `moduleFileExtensions` order (`js` before `ts`,
  // needed nowhere else since apps/api/src is .ts-only with a SEPARATE
  // `dist/` output dir) would silently resolve this unit layer's
  // extensionless imports of that module's `.ts` source to the committed
  // `.js` file instead — CommonJS output that can't `require()` NestJS 12's
  // ESM-only packages under this runtime. Unit tests import module sources
  // the same way every other apps/api/test/** spec imports apps/api/src/**
  // (straight from `.ts`, never the compiled output), so `.ts` must win here.
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: COVERAGE_GATE_FILES,
  coverageThreshold: {
    // Jest's own Config.CoverageThreshold type requires a `global` key
    // structurally even for a purely per-file gate — left empty (no
    // thresholds) since this project deliberately never chased a blanket
    // global number (see this file's own docblock above).
    global: {},
    'src/common/guards/permission.guard.ts': { lines: 80 },
    'src/common/interceptors/audit.interceptor.ts': { lines: 80 },
    'src/core/auth/auth.service.ts': { lines: 80 },
    'src/core/auth/auth.controller.ts': { lines: 80 },
    'src/core/module-registry/module-registry.service.ts': { lines: 80 },
  },
};

export default config;
