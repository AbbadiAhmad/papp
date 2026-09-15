# Testing Strategy

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

## 6. Module lifecycle tests

- Installing a module with a manifest that fails validation (bad `compatibleAppVersion`, missing `ar` locale, colliding `basePath`) is rejected and leaves no partial state (`module_registry` row, if any, is `failed`, not `installed`).
- Installing twice is idempotent / clearly rejected (no duplicate migrations applied — checksum check catches an edited already-applied migration file).
- Upgrade only applies new migrations and does not re-apply `defaultRolePermissions` over existing grants (regression test using a manually-altered grant, asserted unchanged after upgrade).

## 7. CI gate (once code exists)

All of the above run on every push to the single branch (D4) before merge/deploy is considered safe: `lint → typecheck → unit → integration (testcontainers) → e2e (backend) → frontend unit → frontend e2e (smoke subset) → manifest/locale lint`. Coverage target: **80%** lines on `PermissionGuard`, `AuditInterceptor`, `AuthModule`, and the module registry specifically (the security-critical core) — no fixed global percentage mandated elsewhere, since chasing a number on UI code isn't the goal.
