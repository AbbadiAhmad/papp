import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AuthService } from '../../../src/core/auth/auth.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { REFRESH_TOKEN_COOKIE_NAME } from '../../../src/core/auth/jwt.constants';
import { SettingsService } from '../../../src/core/settings/settings.service';
import { PASSWORD_POLICY_KEY, PasswordPolicy } from '../../../src/core/settings/settings.types';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { TEST_USER_PASSWORD, createUserWithRole, fixtureForRole } from '../../../../../test/support/permission-matrix';

/**
 * Tier 2 e2e (docs/TESTING_STRATEGY.md §4/§6): the full real auth flow —
 * login/refresh/logout/register/force-password-change — against a really
 * booted app + real Testcontainers Postgres. Every assertion here exercises
 * the REAL AuthService/AuthController, never a mock.
 */
describe('Auth (e2e)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  function server() {
    return app!.getHttpServer();
  }

  describe('POST /auth/login', () => {
    it('rejects a bad password with a generic 401 (never leaks which emails exist)', async () => {
      const fixture = await fixtureForRole(app!, 'reader');
      const res = await request(server()).post('/auth/login').send({ email: fixture.email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    });

    it('rejects an unknown email with the SAME generic 401', async () => {
      const res = await request(server())
        .post('/auth/login')
        .send({ email: 'no-such-user@papp.test', password: TEST_USER_PASSWORD });
      expect(res.status).toBe(401);
    });

    it('issues a real access token + sets the httpOnly refresh cookie on success, and writes a login audit row', async () => {
      const fixture = await fixtureForRole(app!, 'library_assistant');
      const res = await request(server()).post('/auth/login').send({ email: fixture.email, password: TEST_USER_PASSWORD });

      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.accessToken.length).toBeGreaterThan(10);

      const setCookie = res.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
      expect(cookieHeader).toContain(REFRESH_TOKEN_COOKIE_NAME);
      expect(cookieHeader.toLowerCase()).toContain('httponly');

      const prisma = app!.get(PrismaService);
      const row = await prisma.auditLog.findFirst({
        where: { category: 'core.auth', action: 'login', actorUserId: fixture.userId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(row).not.toBeNull();
      expect(row!.actorType).toBe('user');
    });

    it('locks the account out after maxFailedAttempts wrong passwords (auth.password_policy)', async () => {
      const prisma = app!.get(PrismaService);
      const settings = app!.get(SettingsService);
      const policy = await settings.get<PasswordPolicy>(PASSWORD_POLICY_KEY);

      const target = await createUserWithRole(app!, 'reader', { label: 'lockout-target' });

      for (let i = 0; i < policy.maxFailedAttempts; i++) {
        await request(server()).post('/auth/login').send({ email: target.email, password: 'definitely-wrong' });
      }

      const res = await request(server()).post('/auth/login').send({ email: target.email, password: TEST_USER_PASSWORD });
      expect(res.status).toBe(423); // HttpStatus.LOCKED

      const user = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
      expect(user.lockedUntil).not.toBeNull();
    });
  });

  describe('POST /auth/refresh', () => {
    async function loginAndGetRefreshCookie(email: string) {
      const res = await request(server()).post('/auth/login').send({ email, password: TEST_USER_PASSWORD });
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      const cookie = setCookie.find((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`));
      return cookie!.split(';')[0];
    }

    it('rotates the refresh token and issues a new access token', async () => {
      const target = await createUserWithRole(app!, 'reader', { label: 'refresh-rotate' });
      const cookie = await loginAndGetRefreshCookie(target.email);

      const refreshRes = await request(server()).post('/auth/refresh').set('Cookie', cookie);
      expect(refreshRes.status).toBe(200);
      expect(typeof refreshRes.body.accessToken).toBe('string');

      const newCookieHeader = refreshRes.headers['set-cookie'] as unknown as string[];
      const newCookie = newCookieHeader.find((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`))!.split(';')[0];
      expect(newCookie).not.toBe(cookie);
    });

    it('reusing an already-rotated-away refresh token revokes EVERY active session for that user (theft detection)', async () => {
      const target = await createUserWithRole(app!, 'reader', { label: 'refresh-reuse' });
      const cookie = await loginAndGetRefreshCookie(target.email);

      // Rotate once (old cookie is now "used").
      const firstRefresh = await request(server()).post('/auth/refresh').set('Cookie', cookie);
      expect(firstRefresh.status).toBe(200);

      // Replay the OLD (already-rotated) refresh token.
      const replay = await request(server()).post('/auth/refresh').set('Cookie', cookie);
      expect(replay.status).toBe(401);

      // Every session for this user (including the one just rotated to) is now revoked.
      const prisma = app!.get(PrismaService);
      const sessions = await prisma.userSession.findMany({ where: { userId: target.userId } });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    });

    it('rejects a request with no refresh cookie at all', async () => {
      const res = await request(server()).post('/auth/refresh');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the caller\'s own session and writes a logout audit row', async () => {
      const target = await createUserWithRole(app!, 'reader', { label: 'logout' });

      const logoutRes = await request(server()).post('/auth/logout').set('Authorization', `Bearer ${target.token}`);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body).toEqual({ success: true });

      // The revoked session's access token is rejected on the very next request.
      const meRes = await request(server()).get('/users/me').set('Authorization', `Bearer ${target.token}`);
      expect(meRes.status).toBe(401);

      const prisma = app!.get(PrismaService);
      const row = await prisma.auditLog.findFirst({
        where: { category: 'core.auth', action: 'logout', actorUserId: target.userId },
      });
      expect(row).not.toBeNull();
    });

    it('rejects an anonymous logout with 401', async () => {
      const res = await request(server()).post('/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/force-password-change', () => {
    it('blocks every other guarded endpoint until the password is changed, then unblocks it', async () => {
      const prisma = app!.get(PrismaService);
      const authService = app!.get(AuthService);
      const roleRow = await prisma.role.findUniqueOrThrow({ where: { code: 'reader' } });
      const argon2 = await import('argon2');
      const email = `e2e-force-pwd-${Date.now()}@papp.test`;
      const passwordHash = await argon2.hash(TEST_USER_PASSWORD, { type: argon2.argon2id });
      const user = await prisma.user.create({
        data: { email, name: 'Force PWD', passwordHash, mustChangePassword: true, isActive: true },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });

      const tokens = await authService.login(email, TEST_USER_PASSWORD, { ipAddress: '127.0.0.1', userAgent: 'test' });

      // Blocked: GET /users/me carries @AllowMustChangePassword so it stays
      // reachable (frontend needs it to even LEARN mustChangePassword=true),
      // but a normal guarded endpoint like GET /sessions/me does not.
      const meRes = await request(server()).get('/users/me').set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.mustChangePassword).toBe(true);

      const sessionsRes = await request(server())
        .get('/sessions/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(sessionsRes.status).toBe(403);

      const changeRes = await request(server())
        .post('/auth/force-password-change')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ newPassword: 'BrandNewPass456' });
      expect(changeRes.status).toBe(200);

      const sessionsAfter = await request(server())
        .get('/sessions/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(sessionsAfter.status).toBe(200);
    });
  });

  describe('POST /auth/register (D41/D91 self-registration)', () => {
    /**
     * D91: `selfRegistrationRoleCode` is now admin-configurable, never a
     * hardcoded role — these tests explicitly configure "reader" (any
     * seeded base role would do) rather than relying on app code to assume
     * it. `roleCode` defaults to it but a test can pass another seeded
     * role to prove the setting is actually read, not just a ignored.
     */
    async function setSelfRegistration(enabled: boolean, roleCode = 'reader') {
      const admin = await fixtureForRole(app!, 'admin');
      const res = await request(server())
        .put('/settings/registration')
        .set('Authorization', `Bearer ${admin.token}`)
        .send(enabled ? { allowSelfRegistration: enabled, selfRegistrationRoleCode: roleCode } : { allowSelfRegistration: enabled });
      expect(res.status).toBe(200);
    }

    it('403s while self-registration is disabled (the seeded default)', async () => {
      await setSelfRegistration(false);
      const res = await request(server())
        .post('/auth/register')
        .send({ email: `e2e-reg-off-${Date.now()}@papp.test`, name: 'Nope', password: 'RegisterPass123' });
      expect(res.status).toBe(403);
    });

    it('403s when enabled but no role has ever been configured', async () => {
      // A truly fresh install: allowSelfRegistration flips on, but the
      // admin never touched the role dropdown (users.self_registration_role_code
      // stays at migration 0013's seeded `null`).
      const admin = await fixtureForRole(app!, 'admin');
      const toggleRes = await request(server())
        .put('/settings/registration')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ allowSelfRegistration: true });
      expect(toggleRes.status).toBe(200);

      const res = await request(server())
        .post('/auth/register')
        .send({ email: `e2e-reg-no-role-${Date.now()}@papp.test`, name: 'No Role', password: 'RegisterPass123' });
      expect(res.status).toBe(403);

      await setSelfRegistration(false);
    });

    // D92: reproduces a real user report — registering with an email that
    // already exists (via the ADMIN "create user" screen, nothing to do
    // with self-registration) returned "no role configured" (403) instead
    // of "this email is taken" (409), because the original check order put
    // server config ahead of the registrant's own input. The duplicate
    // check must win regardless of whether a role has ever been configured.
    it('409s (not 403) for an email that already exists, even when self-registration has no role configured', async () => {
      const existing = await createUserWithRole(app!, 'reader', { label: 'd92-duplicate' });

      const admin = await fixtureForRole(app!, 'admin');
      const toggleRes = await request(server())
        .put('/settings/registration')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ allowSelfRegistration: true });
      expect(toggleRes.status).toBe(200);

      const res = await request(server())
        .post('/auth/register')
        .send({ email: existing.email, name: 'Duplicate Attempt', password: 'RegisterPass123' });
      expect(res.status).toBe(409);

      await setSelfRegistration(false);
    });

    it('once enabled with a configured role, creates the account and assigns EXACTLY that role (never auto-login)', async () => {
      await setSelfRegistration(true, 'reader');
      const email = `e2e-reg-on-${Date.now()}@papp.test`;
      const res = await request(server())
        .post('/auth/register')
        .send({ email, name: 'Self Registered', password: 'RegisterPass123' });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe(email);
      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('passwordHash');

      const prisma = app!.get(PrismaService);
      const roles = await prisma.userRole.findMany({
        where: { userId: res.body.id },
        include: { role: true },
      });
      expect(roles.map((r) => r.role.code)).toEqual(['reader']);

      // Real login afterward proves the account is genuinely usable.
      const loginRes = await request(server()).post('/auth/login').send({ email, password: 'RegisterPass123' });
      expect(loginRes.status).toBe(200);

      // Public @Audit route: actor_type='anonymous' (no session existed yet).
      const row = await prisma.auditLog.findFirst({
        where: { category: 'core.auth', action: 'register', entityId: res.body.id },
      });
      expect(row).not.toBeNull();
      expect(row!.actorType).toBe('anonymous');
      expect(row!.actorUserId).toBeNull();

      await setSelfRegistration(false);
    });

    it('PublicThrottlerGuard 429s a burst of anonymous register calls over the per-IP limit', async () => {
      await setSelfRegistration(true);
      const settings = app!.get(SettingsService);
      const limitConfig = await settings.get<{ limit: number; windowSeconds: number }>(
        'security.public_endpoint_rate_limit',
      );

      const attempts = limitConfig.limit + 3;
      const statuses: number[] = [];
      for (let i = 0; i < attempts; i++) {
        const res = await request(server())
          .post('/auth/register')
          .send({ email: `e2e-throttle-${Date.now()}-${i}@papp.test`, name: 'Throttle', password: 'ThrottlePass123' });
        statuses.push(res.status);
      }

      expect(statuses.some((s) => s === 429)).toBe(true);
      await setSelfRegistration(false);
    }, 30_000);
  });
});
