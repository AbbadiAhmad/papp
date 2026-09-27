/**
 * The permission-matrix test helper (docs/TESTING_STRATEGY.md §2) — REAL
 * implementation, Phase 9 (Tier 2 backend e2e hardening).
 *
 * Lives at the repo root — not inside apps/api or apps/web — per the
 * original Phase 0 stub's rationale (importable from both backend and,
 * later, frontend e2e tests):
 *
 *   import { expectPermissionEnforced } from '../../../../../test/support/permission-matrix';
 *
 * This is a REAL implementation against a really-booted app + real
 * Testcontainers Postgres + the real seeded roles/permissions
 * (apps/api/src/core/migrations/0004-0007*.sql, modules/*\/manifest.json
 * defaultRolePermissions) — nothing here is mocked. It:
 *
 *  - creates a real `users` row per base role (directly via Prisma — the
 *    fastest real way to get a user "into" a role without going through
 *    admin-only endpoints that themselves need to be permission-tested),
 *    assigns the role via a real `user_roles` row, then calls the REAL
 *    `AuthService.login()` (the exact same code path `POST /auth/login`
 *    uses) to get a genuine, signed access token — never a hand-crafted JWT
 *    or a mocked guard;
 *  - resolves "does this role hold this permission" fresh from
 *    `role_permissions` on every call (mirrors PermissionGuard's own
 *    "never cached" contract), so a spec that changes grants mid-file is
 *    always checked against truth, not a stale snapshot.
 *
 * One fixture user per (app instance, role code) is created and cached —
 * cheap enough (one bcrypt/argon2 hash + one login) and avoids creating a
 * fresh admin/finance/reader/library_assistant account for every single
 * `expectPermissionEnforced()` call in a spec file that may cover a dozen
 * endpoints.
 */

import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
// Real, running-application types — imported from apps/api's own TS source
// (never mocked, never a hand-rolled shape). See this file's own docblock
// for why the helper lives at the repo root while importing from apps/api.
// eslint-disable-next-line import/no-relative-packages
import { AuthService } from '../../apps/api/src/core/auth/auth.service';
// eslint-disable-next-line import/no-relative-packages
import { PrismaService } from '../../apps/api/src/prisma/prisma.service';

/** The 4 base roles (D9), seeded by 0004_create_roles_permissions.sql. */
export const ALL_ROLE_CODES = ['admin', 'library_assistant', 'finance', 'reader'] as const;
export type RoleCode = (typeof ALL_ROLE_CODES)[number];

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete' | 'put';

/**
 * Meets the seeded default `auth.password_policy` (0003_create_system_settings.sql:
 * minLength 10, requireLetter, requireNumber) with room to spare even if a
 * spec file's own settings test raises `minLength` temporarily.
 */
export const TEST_USER_PASSWORD = 'PermMatrix#Test123';

export interface RoleFixture {
  userId: string;
  email: string;
  token: string;
}

const roleFixtureCache = new WeakMap<INestApplication, Map<RoleCode, RoleFixture>>();
let emailSequence = 0;

function nextTestEmail(label: string): string {
  emailSequence += 1;
  return `e2e-${label}-${Date.now()}-${emailSequence}@papp.test`.toLowerCase();
}

/**
 * Creates (once, cached per `app` + `role`) a real user assigned to the base
 * role `role`, and logs them in for real via `AuthService.login()`. Safe to
 * call many times across many `expectPermissionEnforced()` invocations in
 * one spec file — later calls for the same (app, role) return the cached
 * fixture instead of creating a new account.
 */
export async function fixtureForRole(app: INestApplication, role: RoleCode): Promise<RoleFixture> {
  let byRole = roleFixtureCache.get(app);
  if (!byRole) {
    byRole = new Map();
    roleFixtureCache.set(app, byRole);
  }
  const cached = byRole.get(role);
  if (cached) return cached;

  const prisma = app.get(PrismaService);
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { code: role } });

  const email = nextTestEmail(role);
  const passwordHash = await argon2.hash(TEST_USER_PASSWORD, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: {
      email,
      name: `E2E ${role}`,
      passwordHash,
      // Fixture accounts must be immediately usable — a forced password
      // change would 403 every other endpoint via MustChangePasswordGuard.
      mustChangePassword: false,
      isActive: true,
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });

  const authService = app.get(AuthService);
  const tokens = await authService.login(email, TEST_USER_PASSWORD, {
    ipAddress: '127.0.0.1',
    userAgent: 'permission-matrix-helper',
  });

  const fixture: RoleFixture = { userId: user.id, email, token: tokens.accessToken };
  byRole.set(role, fixture);
  return fixture;
}

export async function tokenFor(app: INestApplication, role: RoleCode): Promise<string> {
  return (await fixtureForRole(app, role)).token;
}

export async function userIdFor(app: INestApplication, role: RoleCode): Promise<string> {
  return (await fixtureForRole(app, role)).userId;
}

/**
 * Creates a standalone real user (not one of the cached role fixtures) with
 * an arbitrary base role, and logs them in for real. Useful when a spec
 * needs its own disposable account (e.g. a session-revocation test) without
 * disturbing the shared role fixtures.
 */
export async function createUserWithRole(
  app: INestApplication,
  role: RoleCode,
  opts: { label?: string; mustChangePassword?: boolean } = {},
): Promise<RoleFixture & { password: string }> {
  const prisma = app.get(PrismaService);
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { code: role } });

  const email = nextTestEmail(opts.label ?? role);
  const password = TEST_USER_PASSWORD;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: {
      email,
      name: `E2E ${opts.label ?? role}`,
      passwordHash,
      mustChangePassword: opts.mustChangePassword ?? false,
      isActive: true,
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });

  if (opts.mustChangePassword) {
    // No usable token yet — force-password-change blocks login-derived
    // tokens from doing anything else. Caller logs in itself via supertest
    // to exercise that flow (see auth.e2e-spec.ts).
    return { userId: user.id, email, token: '', password };
  }

  const authService = app.get(AuthService);
  const tokens = await authService.login(email, password, {
    ipAddress: '127.0.0.1',
    userAgent: 'permission-matrix-helper',
  });
  return { userId: user.id, email, token: tokens.accessToken, password };
}

/**
 * Resolves, fresh from `role_permissions` (never cached across calls —
 * mirrors PermissionGuard's own contract), whether the base role `role`
 * currently holds `permissionCode`.
 */
export async function roleHasPermission(app: INestApplication, role: RoleCode, permissionCode: string): Promise<boolean> {
  const prisma = app.get(PrismaService);
  const grant = await prisma.rolePermission.findFirst({
    where: { role: { code: role }, permission: { code: permissionCode } },
  });
  return grant !== null;
}

function defaultSuccessStatus(method: HttpMethod): number {
  switch (method) {
    case 'get':
      return 200;
    case 'post':
      return 201;
    case 'patch':
      return 200;
    case 'put':
      return 200;
    case 'delete':
      return 204;
    default:
      return 200;
  }
}

export interface ExpectPermissionEnforcedOptions {
  /**
   * A GETTER for the already-booted app under test (see
   * apps/api/test/support/bootstrap-app.ts) — deliberately a function, not
   * the app itself. Every call site invokes `expectPermissionEnforced(...)`
   * directly inside a `describe(...)` body (required — it registers a real
   * Jest `it(...)`, which must happen at collection time), which runs
   * BEFORE that file's own `beforeAll` has assigned its `app` variable. A
   * plain `app: INestApplication` value would therefore capture `undefined`
   * permanently in this function's closure (real bug, found via real CI:
   * every `it(...)` this produced threw `Cannot read properties of
   * undefined (reading 'get')` the moment it actually ran, since JS
   * evaluates call arguments eagerly). A getter defers reading `app` until
   * the `it(...)` callback actually executes, by which point `beforeAll`
   * has run — call sites pass `() => app!`, never `app!` directly.
   */
  app: () => INestApplication;
  /** HTTP method of the endpoint under test. */
  method: HttpMethod;
  /** Request path, e.g. "/users/:id" with concrete values already substituted by the caller. */
  path: string;
  /** The permission code the endpoint is expected to require, e.g. "users.create". */
  requiredPermission: string;
  /**
   * A body that would succeed if the caller were authorized (for
   * post/patch/put). May be a function of the role under test, for
   * endpoints where a fixed body would collide on a unique constraint (e.g.
   * two roles both allowed to create a row with the same fixed identifier).
   */
  validBody?: object | ((role: RoleCode) => object | undefined);
  /** Overrides the default per-method expected success status (get=200, post=201, patch/put=200, delete=204). */
  expectedSuccessStatus?: number;
  /** Defaults to all 4 base roles; narrow this only when a role's success path cannot be safely re-run (documented at the call site). */
  roles?: readonly RoleCode[];
}

/**
 * Registers a Jest `it(...)` (docs/TESTING_STRATEGY.md §2) that, against the
 * real booted `app`, spins through every base role and asserts:
 *  - a role holding `requiredPermission` (per the real `role_permissions`
 *    table) -> the endpoint's real success status;
 *  - a role that does not hold it -> 403;
 *  - no auth token at all -> 401.
 */
export function expectPermissionEnforced(opts: ExpectPermissionEnforcedOptions): void {
  const roles = opts.roles ?? ALL_ROLE_CODES;
  const successStatus = opts.expectedSuccessStatus ?? defaultSuccessStatus(opts.method);

  it(`${opts.method.toUpperCase()} ${opts.path} requires permission "${opts.requiredPermission}"`, async () => {
    const app = opts.app();
    for (const role of roles) {
      const [hasPerm, token] = await Promise.all([
        roleHasPermission(app, role, opts.requiredPermission),
        tokenFor(app, role),
      ]);
      const body = typeof opts.validBody === 'function' ? opts.validBody(role) : opts.validBody;

      const agent = request(app.getHttpServer());
      let req = agent[opts.method](opts.path).set('Authorization', `Bearer ${token}`);
      if (body !== undefined) req = req.send(body);
      const res = await req;

      if (hasPerm) {
        expect({ role, status: res.status, body: res.body }).toEqual({ role, status: successStatus, body: res.body });
      } else {
        expect({ role, status: res.status }).toEqual({ role, status: 403 });
      }
    }

    const anonBody = typeof opts.validBody === 'function' ? opts.validBody(roles[0]) : opts.validBody;
    let anonReq = request(app.getHttpServer())[opts.method](opts.path);
    if (anonBody !== undefined) anonReq = anonReq.send(anonBody);
    const anonRes = await anonReq;
    expect(anonRes.status).toBe(401);
  });
}
