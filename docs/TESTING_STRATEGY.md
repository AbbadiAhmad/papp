# Testing Strategy

## 0. Testing tiers — what to write now vs. defer (D37)

Two tiers, deliberately sequenced differently across the project's timeline:

**Tier 1 — lean, write continuously in every phase (Phases 1–8):**
- Pure unit tests: business logic in services/guards/interceptors, with dependencies **mocked** (mock Prisma, no real DB, no containers, no network, no browser). Runs in seconds.
- Static/lint checks: manifest⇄code permission consistency, locale completeness, "no hardcoded role name," and the `@Sensitive()` schema-scan test (it's pure Prisma-DMMF introspection — no DB connection needed, so it belongs in Tier 1 despite touching the schema).
- Rule of thumb: if a test needs Docker, a real Postgres, a browser, or more than a couple seconds to run, it is **not** Tier 1.

**Tier 2 — heavier, deferred to a dedicated hardening pass (`BUILD_PLAN.md` Phase 9, after Phase 8):**
- Testcontainers-backed integration tests (real throwaway Postgres per run).
- Full e2e tests (Supertest against a really-booted app + real DB), including the permission-matrix multi-role sweep (§2 below).
- Playwright browser e2e.
- CI coverage-gate enforcement (§8).

**Why sequenced this way:** Phase 0's Tester agent spent ~800s and 119 tool calls fighting Testcontainers/ESM/Jest configuration to produce integration tests that still couldn't actually execute in this dev sandbox (Docker image pulls are egress-blocked here) — correct, well-written tests, but that cost repeated every single phase would slow the whole build far more than the tests are worth this early, before the shape of the code has settled. Instead: **Tier 1 tests are still mandatory every phase** (they're cheap and catch real logic bugs immediately), but Tier 2 is written **once**, in Phase 9, in one dedicated pass across everything built in Phases 0–8, run against real CI Docker access (Phase 7's pipeline) rather than fought against a sandbox that can't run it anyway.

**Per-phase acceptance during Phases 1–8** is therefore: Tier 1 tests pass, `npm run build`/`npm run lint` clean, **and** a manual or scripted smoke verification (a curl transcript or a scratch script run against a real reachable Postgres — the same substitute the Phase 0/1 Developer agents already used) demonstrating the feature genuinely works end-to-end. That smoke verification is not committed as a test file; it's real command output pasted into the agent's report and reviewed by the orchestrator before commit — it substitutes for automated e2e until Phase 9 makes it permanent.

Any "Tester builds" bullet elsewhere in `BUILD_PLAN.md` that names Testcontainers, a booted app + real DB, or Playwright is Tier 2 — skip it when that phase actually runs; Phase 9 lists the full deferred set.

**Known Tier 1 gotcha (apps/api):** this project's Jest config runs tests as real ESM (`extensionsToTreatAsEsm` + `NODE_OPTIONS=--experimental-vm-modules`, needed because NestJS 12's own packages ship ESM-only — see Phase 0's commit history). Under that setup, `describe`/`it`/`expect`/`beforeEach`/`afterEach` work as ambient globals, but **`jest` itself does not** — a bare `jest.fn()`/`jest.spyOn(...)` throws `ReferenceError: jest is not defined`. Fix: explicitly `import { jest, describe, it, expect, ... } from '@jest/globals';` in any spec file that uses `jest.*`. Hit this once in Phase 1; documented here so it isn't rediscovered every phase.

## 1. Tooling

| Layer | Tool | What it covers |
|---|---|---|
| Backend unit | Jest | Services, guards, interceptors, pure logic (permission resolution, audit diffing, JWT/session logic) |
| Backend integration | Jest + Testcontainers (real PostgreSQL in a throwaway container) | Repository/Prisma queries, migrations actually applying cleanly, module install/upgrade/uninstall flow |
| Backend e2e | Jest + Supertest, against a running NestJS instance | Full HTTP request → permission guard → controller → DB → audit log, per endpoint |
| Frontend unit/component | Vitest + React Testing Library | Components, hooks (`usePermission`, `useBooksQuery`), i18n rendering, RTL/LTR switch |
| Frontend e2e | Playwright | Login flow, force-password-change flow, permission-driven UI (a `reader` truly can't see a `finance`-only page), language switch |
| Static/lint checks | Custom scripts run in CI | Manifest ⇄ code permission-code consistency, `ar` locale completeness vs `en`, "no hardcoded role name" grep rule |

## 2. The permission-matrix test pattern (the important one)

Every protected endpoint must be covered by a shared test helper that, given a route + method + required permission code, spins through **every role** and asserts:
- A role holding the permission (directly or via manifest default) → success status.
- A role **not** holding it → `403`.
- No auth token at all → `401`.

```ts
// test/support/permission-matrix.ts (illustrative)
export function expectPermissionEnforced(opts: {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  requiredPermission: string;
  validBody?: object;
}) {
  it(`${opts.method.toUpperCase()} ${opts.path} requires ${opts.requiredPermission}`, async () => {
    for (const role of ALL_ROLES) {
      const hasPerm = await roleHasPermission(role, opts.requiredPermission);
      const token = await tokenFor(role);
      const res = await request(app)[opts.method](opts.path).set('Authorization', `Bearer ${token}`).send(opts.validBody);
      expect(res.status).toBe(hasPerm ? expectSuccessStatus(opts.method) : 403);
    }
    const anon = await request(app)[opts.method](opts.path).send(opts.validBody);
    expect(anon.status).toBe(401);
  });
}
```

This one helper, called once per endpoint in a module's e2e test file, is what makes "every action is permission-gated" a tested guarantee rather than a hope. It's part of the required checklist in `.claude/skills/papp-add-feature/SKILL.md` for any new endpoint.

## 3. Audit log tests

For every mutating endpoint: perform the action, then assert an `audit_log` row exists with the right `category`/`entityType`/`action`, and that `old_value`/`new_value` match expectations (including that a field marked `@Sensitive()` never appears un-redacted — this is asserted via a **schema-scan test**, not per-endpoint, so it can't be forgotten: it enumerates all Prisma fields matching sensitive name patterns (`password`, `Hash`, `token`, `secret`) and fails the build if one isn't marked `@Sensitive()`).

## 4. Session/security tests

- Login issues access+refresh tokens; refresh rotates and invalidates the old one; reusing an old refresh token revokes the session (theft-detection behavior from `ARCHITECTURE.md` §6.1).
- Idle timeout and absolute timeout both independently expire a session.
- Admin can see and force-revoke another user's session; a revoked session's access token is rejected on the very next request (no stale-token grace window).
- Force-password-change flag blocks every other endpoint until the password is changed.

## 5. i18n/RTL tests

- A snapshot/lint test asserts every key present in a module's `en.json` also exists in `ar.json` (and vice versa) — catches "shipped without Arabic" and "forgot to translate the new key" both.
- A component test renders one representative page in both `ar` (RTL) and `en` (LTR) and asserts `dir="rtl"`/`dir="ltr"` propagates to the root and that number/date formatting output uses Latin digits and the Gregorian calendar in both.

## 6. Public/anonymous route tests

For any endpoint marked `@Public()`: an e2e test asserts it's reachable with **no** `Authorization` header (not a 401), that `audit_log` (if the action is audited) records `actor_type = 'anonymous'` with a null `actor_user_id` but a captured IP/user-agent, and — for a public **write** endpoint — that the `ThrottlerGuard` actually rejects a burst of requests over the configured per-IP limit (`system_settings.security.public_endpoint_rate_limit`) with a 429, not silently accepting unlimited requests.

## 7. Module lifecycle tests

- Installing a module with a manifest that fails validation (bad `compatibleAppVersion`, missing `ar` locale, colliding `basePath`) is rejected and leaves no partial state (`module_registry` row, if any, is `failed`, not `installed`).
- Installing twice is idempotent / clearly rejected (no duplicate migrations applied — checksum check catches an edited already-applied migration file).
- Upgrade only applies new migrations and does not re-apply `defaultRolePermissions` over existing grants (regression test using a manually-altered grant, asserted unchanged after upgrade).

## 8. CI gate (once code exists)

All of the above run on every push to the single branch (D4) before merge/deploy is considered safe: `lint → typecheck → unit → integration (testcontainers) → e2e (backend) → frontend unit → frontend e2e (smoke subset) → manifest/locale lint`. Coverage target: **80%** lines on `PermissionGuard`, `AuditInterceptor`, `AuthModule`, and the module registry specifically (the security-critical core) — no fixed global percentage mandated elsewhere, since chasing a number on UI code isn't the goal.
