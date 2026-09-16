import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { ALL_ROLE_CODES, createUserWithRole, fixtureForRole } from '../../../../../test/support/permission-matrix';

describe('Sessions (e2e)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  describe('GET /sessions/me', () => {
    it('is reachable by every role, self-scoped, no permission grant needed', async () => {
      for (const role of ALL_ROLE_CODES) {
        const fixture = await fixtureForRole(app!, role);
        const res = await request(app!.getHttpServer()).get('/sessions/me').set('Authorization', `Bearer ${fixture.token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
      }
    });

    it('401s anonymously', async () => {
      const res = await request(app!.getHttpServer()).get('/sessions/me');
      expect(res.status).toBe(401);
    });
  });

  describe('permission matrix', () => {
    it('GET /sessions/user/:userId requires sessions.view', async () => {
      const target = await fixtureForRole(app!, 'reader');
      const { roleHasPermission, tokenFor } = await import('../../../../../test/support/permission-matrix');
      for (const role of ALL_ROLE_CODES) {
        const hasPerm = await roleHasPermission(app!, role, 'sessions.view');
        const token = await tokenFor(app!, role);
        const res = await request(app!.getHttpServer())
          .get(`/sessions/user/${target.userId}`)
          .set('Authorization', `Bearer ${token}`);
        expect({ role, status: res.status }).toEqual({ role, status: hasPerm ? 200 : 403 });
      }
      const anon = await request(app!.getHttpServer()).get(`/sessions/user/${target.userId}`);
      expect(anon.status).toBe(401);
    });
  });

  describe('DELETE /sessions/:id (force revoke)', () => {
    it('requires sessions.revoke, and a revoked session\'s access token is rejected on the VERY NEXT request', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const target = await createUserWithRole(app!, 'reader', { label: 'revoke-target' });

      const before = await request(app!.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${target.token}`);
      expect(before.status).toBe(200);

      const mySessions = await request(app!.getHttpServer())
        .get('/sessions/me')
        .set('Authorization', `Bearer ${target.token}`);
      const sessionId = mySessions.body[0].id;

      const forbidden = await request(app!.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${(await fixtureForRole(app!, 'finance')).token}`);
      expect(forbidden.status).toBe(403);

      const revoke = await request(app!.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(revoke.status).toBe(204);

      // No stale-token grace window: the very next request with the same
      // (now-revoked) access token is rejected.
      const after = await request(app!.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${target.token}`);
      expect(after.status).toBe(401);
    });

    it('401s anonymously', async () => {
      const target = await fixtureForRole(app!, 'reader');
      const mySessions = await request(app!.getHttpServer())
        .get('/sessions/me')
        .set('Authorization', `Bearer ${target.token}`);
      const anon = await request(app!.getHttpServer()).delete(`/sessions/${mySessions.body[0].id}`);
      expect(anon.status).toBe(401);
    });
  });
});
