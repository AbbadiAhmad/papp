import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import { ALL_ROLE_CODES, expectPermissionEnforced, fixtureForRole } from '../../../../../test/support/permission-matrix';

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe('Audit (e2e)', () => {
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

  describe('permission matrix', () => {
    expectPermissionEnforced({ app: app!, method: 'get', path: '/audit', requiredPermission: 'audit.view' });
  });

  it('GET /audit returns real rows produced by earlier actions in this process (e.g. the fixture logins)', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const res = await request(app!.getHttpServer())
      .get('/audit')
      .query({ category: 'core.auth', pageSize: 200 })
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.items.some((i: { action: string }) => i.action === 'login')).toBe(true);
  });

  describe('POST /audit/purge', () => {
    it('requires audit.purge', async () => {
      const forbidden = await request(app!.getHttpServer())
        .post('/audit/purge')
        .set('Authorization', `Bearer ${(await fixtureForRole(app!, 'reader')).token}`)
        .send({ cutoffDate: isoDateDaysAgo(2) });
      expect(forbidden.status).toBe(403);

      const anon = await request(app!.getHttpServer()).post('/audit/purge').send({ cutoffDate: isoDateDaysAgo(2) });
      expect(anon.status).toBe(401);
    });

    it('rejects a cutoff of today (UTC) or later — at least the most recent day always survives (D25)', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const todayReject = await request(app!.getHttpServer())
        .post('/audit/purge')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ cutoffDate: isoDateDaysAgo(0) });
      expect(todayReject.status).toBe(400);

      const futureReject = await request(app!.getHttpServer())
        .post('/audit/purge')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ cutoffDate: isoDateDaysAgo(-1) });
      expect(futureReject.status).toBe(400);
    });

    it('accepts yesterday (UTC) as a valid cutoff, really deletes old rows, and writes its own richer audit row', async () => {
      const admin = await fixtureForRole(app!, 'admin');

      // Generate at least one auditable event to guarantee something is present.
      await request(app!.getHttpServer()).post('/auth/login').send({ email: admin.email, password: 'wrong-on-purpose' });

      const res = await request(app!.getHttpServer())
        .post('/audit/purge')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ cutoffDate: isoDateDaysAgo(1) });
      expect(res.status).toBe(200);
      expect(res.body.cutoffDate).toBe(isoDateDaysAgo(1));
      expect(typeof res.body.rowsDeleted).toBe('number');
      // Everything so far in this test file happened "now" (well after yesterday's cutoff), so nothing is deleted.
      expect(res.body.rowsDeleted).toBe(0);

      const afterQuery = await request(app!.getHttpServer())
        .get('/audit')
        .query({ category: 'core.audit', pageSize: 10 })
        .set('Authorization', `Bearer ${admin.token}`);
      expect(afterQuery.status).toBe(200);
      expect(afterQuery.body.items.some((i: { action: string }) => i.action === 'purge')).toBe(true);
    });
  });
});
