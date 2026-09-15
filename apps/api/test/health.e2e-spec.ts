import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { createTestApp } from './support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from './support/postgres-test-container';

describe('GET /health (e2e)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  it('returns 200 { status: "ok" } once bootstrap + core migrations have run', async () => {
    const res = await request(app!.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
