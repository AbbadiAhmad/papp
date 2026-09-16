import type { INestApplication } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../../../src/core/auth/auth.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';

const PASSWORD = 'Sup3rSecretPassw0rd!';
const META = { ipAddress: '203.0.113.10', userAgent: 'integration-test-agent/1.0' };

/**
 * Tier 2 (docs/TESTING_STRATEGY.md §0): AuthService + the `user_sessions`
 * table against a REAL Postgres — exactly the behavior Tier 1's mocked-Prisma
 * `auth.service.spec.ts` cannot prove: a real row is written, a real
 * transaction-free multi-statement rotation really flips `revoked_at`, and
 * the lockout counters really persist across separate calls that each read
 * the row fresh from the DB (a mock can be made to return whatever the test
 * wants — only a real re-SELECT proves the write actually landed).
 */
describe('AuthService + user_sessions (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  async function createUser(overrides: { email?: string } = {}): Promise<{ id: string; email: string }> {
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email: overrides.email ?? `${randomUUID()}@example.com`,
        name: 'Integration Test User',
        passwordHash,
        isActive: true,
      },
    });
    return { id: user.id, email: user.email };
  }

  describe('login()', () => {
    it('writes a real user_sessions row and updates lastLoginAt/failedLoginAttempts on the users row', async () => {
      const user = await createUser();

      const tokens = await authService.login(user.email, PASSWORD, META);

      const sessionRow = await prisma.userSession.findUnique({ where: { id: tokens.sessionId } });
      expect(sessionRow).not.toBeNull();
      expect(sessionRow?.userId).toBe(user.id);
      expect(sessionRow?.revokedAt).toBeNull();
      expect(sessionRow?.ipAddress).toBe(META.ipAddress);
      expect(sessionRow?.userAgent).toBe(META.userAgent);
      // The raw refresh token is never what's stored — only its SHA-256 hash.
      expect(sessionRow?.refreshTokenHash).not.toBe(tokens.refreshToken);
      expect(sessionRow?.refreshTokenHash).toHaveLength(64);

      const userRow = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(userRow.failedLoginAttempts).toBe(0);
      expect(userRow.lastLoginAt).not.toBeNull();
    });
  });

  describe('refresh() rotation', () => {
    it('rotating a valid refresh token revokes the OLD session row and creates a genuinely new one', async () => {
      const user = await createUser();
      const first = await authService.login(user.email, PASSWORD, META);

      const second = await authService.refresh(first.refreshToken, META);

      expect(second.sessionId).not.toBe(first.sessionId);

      const oldRow = await prisma.userSession.findUniqueOrThrow({ where: { id: first.sessionId } });
      expect(oldRow.revokedAt).not.toBeNull();

      const newRow = await prisma.userSession.findUniqueOrThrow({ where: { id: second.sessionId } });
      expect(newRow.revokedAt).toBeNull();
      expect(newRow.userId).toBe(user.id);
    });

    it('reuse of an already-rotated-away refresh token revokes EVERY active session for that user in the DB', async () => {
      const user = await createUser();
      const first = await authService.login(user.email, PASSWORD, META);
      const second = await authService.refresh(first.refreshToken, META);
      // second.sessionId is currently active. Now replay the stale `first`
      // refresh token — theft-detection territory.
      await expect(authService.refresh(first.refreshToken, META)).rejects.toThrow(/reuse detected/i);

      const allSessions = await prisma.userSession.findMany({ where: { userId: user.id } });
      expect(allSessions.length).toBeGreaterThanOrEqual(2);
      expect(allSessions.every((s) => s.revokedAt !== null)).toBe(true);

      // The session that survived the rotation and looked perfectly valid a
      // moment ago is now revoked too — proves the "revoke ALL" behavior
      // isn't limited to the reused row itself.
      const survivorRow = await prisma.userSession.findUniqueOrThrow({ where: { id: second.sessionId } });
      expect(survivorRow.revokedAt).not.toBeNull();
    });
  });

  describe('lockout persistence', () => {
    it('failedLoginAttempts increments per bad attempt and lockedUntil is set (and counter reset) once the threshold is hit', async () => {
      const user = await createUser();
      // Seeded default policy (0003_create_system_settings.sql): maxFailedAttempts = 5.
      const MAX_FAILED_ATTEMPTS = 5;

      for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
        await expect(authService.login(user.email, 'wrong-password', META)).rejects.toThrow(/invalid email or password/i);
        const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        expect(row.failedLoginAttempts).toBe(attempt);
        expect(row.lockedUntil).toBeNull();
      }

      // The 5th bad attempt trips the lockout.
      await expect(authService.login(user.email, 'wrong-password', META)).rejects.toThrow(/invalid email or password/i);
      const lockedRow = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(lockedRow.failedLoginAttempts).toBe(0); // reset once locked
      expect(lockedRow.lockedUntil).not.toBeNull();
      expect((lockedRow.lockedUntil as Date).getTime()).toBeGreaterThan(Date.now());

      // Even the CORRECT password is rejected (423 Locked) while locked —
      // real persisted state read back on a brand new call.
      await expect(authService.login(user.email, PASSWORD, META)).rejects.toMatchObject({
        status: HttpStatus.LOCKED,
      });
    });
  });
});
