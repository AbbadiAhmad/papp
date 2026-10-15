import { DynamicModule, ForwardReference, INestApplication, Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../../../apps/api/src/app.module';
import { MigrationRunnerService } from '../../../../apps/api/src/core/module-registry/migration-runner.service';
import { ModuleRegistryService } from '../../../../apps/api/src/core/module-registry/module-registry.service';
import { PrismaService } from '../../../../apps/api/src/prisma/prisma.service';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../../../apps/api/test/support/postgres-test-container';
import { ALL_ROLE_CODES, expectPermissionEnforced, fixtureForRole } from '../../../../test/support/permission-matrix';

/**
 * Tier 2 e2e for the `survey` module: a REAL install of the REAL module in a
 * really-booted app over real HTTP against a real Postgres. Covers the
 * respondent-facing rules end to end (phase A of ROADMAP.md): bad builder
 * settings are refused, bad answers are refused with the right message, valid
 * ones (selection limits, "Other", validated text) are stored and reported.
 * The bootstrap mirrors library-catalog.e2e-spec.ts (see its docblock for why
 * the module is imported late and as `.ts`).
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..', '..');
const CORE_MIGRATIONS_DIR = join(REPO_ROOT, 'apps', 'api', 'src', 'core', 'migrations');
const DIST_GUARD_PATH = join(REPO_ROOT, 'apps', 'api', 'dist', 'common', 'guards', 'public-throttler.guard.js');

async function bootstrapRegistryTables(): Promise<void> {
  const sql = readFileSync(join(CORE_MIGRATIONS_DIR, '0000_bootstrap_registry.sql'), 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function ensureApiIsBuilt(): void {
  if (existsSync(DIST_GUARD_PATH)) return;
  execSync('npm run build --workspace=@papp/api', { cwd: REPO_ROOT, stdio: 'inherit' });
}

type NestImport = Type<unknown> | DynamicModule | ForwardReference | Promise<DynamicModule>;

async function createAppWithSurveyInstalled(): Promise<INestApplication> {
  await bootstrapRegistryTables();
  ensureApiIsBuilt();
  const { SurveyModule } = (await import('../../backend/survey.module.ts')) as { SurveyModule: Type<unknown> };

  class RootModule {}
  Module({ imports: [AppModule, SurveyModule as NestImport] })(RootModule);
  const app = await NestFactory.create(RootModule, { logger: false });

  await app.get(MigrationRunnerService).applyDirectory(CORE_MIGRATIONS_DIR, 'core');
  await app.get(PrismaService).moduleRegistryEntry.upsert({
    where: { key: 'core' },
    update: {},
    create: { key: 'core', version: '0.0.1', status: 'installed', installedAt: new Date() },
  });
  process.env.MODULES_DIR = join(REPO_ROOT, 'modules');
  await app.get(ModuleRegistryService).install('survey');
  await app.init();
  return app;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SECTION = uuid(1);
const Q = { email: uuid(10), age: uuid(11), pick: uuid(12), fav: uuid(13) };

function structure(overrides: { pickConfig?: Record<string, unknown> } = {}) {
  const opt = (n: number, value: string) => ({ id: uuid(n), orderIndex: n % 10, value, label: value.toUpperCase() });
  return {
    sections: [
      {
        id: SECTION,
        orderIndex: 0,
        title: 'About you',
        questions: [
          { id: Q.email, orderIndex: 0, type: 'short_text', title: 'Email', config: { validation: { kind: 'email' } } },
          {
            id: Q.age,
            orderIndex: 1,
            type: 'short_text',
            title: 'Age',
            config: { validation: { kind: 'number', integer: true, min: 5, max: 99, message: 'Age must be 5 to 99' } },
          },
          {
            id: Q.pick,
            orderIndex: 2,
            type: 'multi_choice',
            title: 'Genres',
            config: overrides.pickConfig ?? { minSelections: 1, maxSelections: 2, exclusiveOptionValue: 'none', allowOther: true },
            options: [opt(20, 'fiction'), opt(21, 'history'), opt(22, 'poetry'), opt(23, 'none')],
          },
          { id: Q.fav, orderIndex: 3, type: 'single_choice', title: 'Section', config: { allowOther: true, otherLabel: 'Something else' }, options: [opt(30, 'kids'), opt(31, 'adults')] },
        ],
      },
    ],
    logicRules: [],
  };
}

describe('survey module (e2e, real install + real HTTP)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;
  let adminToken: string;
  let surveyId: string;
  const http = () => app!.getHttpServer();
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createAppWithSurveyInstalled();
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));
    adminToken = (await fixtureForRole(app!, 'admin')).token;
    // The public-write throttle (per IP) counts rejected submissions too; this suite deliberately sends many.
    const { SettingsService } = await import('../../../../apps/api/src/core/settings/settings.service');
    const current = await app!.get(SettingsService).get<{ limit: number; windowSeconds: number }>('security.public_endpoint_rate_limit');
    await app!.get(SettingsService).set('security.public_endpoint_rate_limit', { ...current, limit: 1000 });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  describe('permission matrix', () => {
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/api/survey/surveys', requiredPermission: 'survey.surveys.view' });
    expectPermissionEnforced({
      app: () => app!,
      method: 'post',
      path: '/api/survey/surveys',
      requiredPermission: 'survey.surveys.create',
      validBody: () => ({ title: 'Matrix survey' }),
    });
  });

  it('builder: refuses settings that do not fit the question, accepts valid ones', async () => {
    const created = await request(http()).post('/api/survey/surveys').set(admin()).send({ title: 'Reader survey' });
    expect(created.status).toBe(201);
    surveyId = created.body.id;

    const tooMany = await request(http())
      .put(`/api/survey/surveys/${surveyId}/structure`)
      .set(admin())
      .send(structure({ pickConfig: { maxSelections: 9 } }));
    expect(tooMany.status).toBe(400);
    expect(JSON.stringify(tooMany.body.message)).toMatch(/Genres.*selection limit/);

    const reserved = structure();
    reserved.sections[0].questions[3].options!.push({ id: uuid(32), orderIndex: 2, value: '__other__', label: 'x' });
    const reservedRes = await request(http()).put(`/api/survey/surveys/${surveyId}/structure`).set(admin()).send(reserved);
    expect(reservedRes.status).toBe(400);
    expect(JSON.stringify(reservedRes.body.message)).toMatch(/reserved/);

    const ok = await request(http()).put(`/api/survey/surveys/${surveyId}/structure`).set(admin()).send(structure());
    expect(ok.status).toBe(200);
    const saved = ok.body.sections[0].questions.find((q: { id: string }) => q.id === Q.pick);
    expect(saved.config).toMatchObject({ minSelections: 1, maxSelections: 2, exclusiveOptionValue: 'none', allowOther: true });

    const publish = await request(http()).post(`/api/survey/surveys/${surveyId}/publish`).set(admin());
    expect([200, 201]).toContain(publish.status);
  });

  describe('respondent submit (public link)', () => {
    const submit = (answers: Array<{ questionId: string; value: unknown }>) =>
      request(http()).post(`/api/survey/public/${surveyId}`).send({ answers });
    const good = () => [
      { questionId: Q.email, value: 'reader@example.com' },
      { questionId: Q.age, value: '34' },
      { questionId: Q.pick, value: ['fiction', 'history'] },
      { questionId: Q.fav, value: 'kids' },
    ];
    const withAnswer = (questionId: string, value: unknown) => good().map((a) => (a.questionId === questionId ? { questionId, value } : a));

    it('the public structure carries the settings the page needs', async () => {
      const res = await request(http()).get(`/api/survey/public/${surveyId}`);
      expect(res.status).toBe(200);
      const pick = res.body.survey.sections[0].questions.find((q: { id: string }) => q.id === Q.pick);
      expect(pick.config.maxSelections).toBe(2);
    });

    it.each([
      ['a malformed email', Q.email, 'reader@', /valid email address/],
      ['an out-of-range number, with the owner\'s own message', Q.age, '120', /Age must be 5 to 99/],
      ['a non-integer number', Q.age, '34.5', /Age must be 5 to 99/],
      ['too many selections', Q.pick, ['fiction', 'history', 'poetry'], /at most 2 selections/],
      ['an exclusive option combined with others', Q.pick, ['none', 'fiction'], /cannot combine/],
      ['an option that does not exist', Q.pick, ['fiction', 'comics'], /not available/],
      ['an "Other" with no text', Q.fav, '__other__:  ', /needs a text/],
      ['an empty "Other" inside a multiple choice', Q.pick, ['fiction', '__other__:'], /needs a text/],
    ])('rejects %s', async (_label, questionId, value, message) => {
      const res = await submit(withAnswer(questionId, value));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toMatch(message);
    });

    it('stores a valid response, including "Other" texts and the exclusive choice', async () => {
      const first = await submit(withAnswer(Q.fav, '__other__:Comics'));
      expect(first.status).toBe(201);
      const second = await submit([...withAnswer(Q.pick, ['poetry', '__other__:Plays']).filter((a) => a.questionId !== Q.fav), { questionId: Q.fav, value: 'adults' }]);
      expect(second.status).toBe(201);
      const third = await submit(withAnswer(Q.pick, ['none']));
      expect(third.status).toBe(201);
    });

    it('an optional question may be left empty (an empty selection is not "answered")', async () => {
      const res = await submit(good().filter((a) => a.questionId !== Q.age).map((a) => (a.questionId === Q.pick ? { questionId: Q.pick, value: ['fiction'] } : a)));
      expect(res.status).toBe(201);
    });
  });

  describe('reports', () => {
    it('the summary collapses "Other" into one bar and lists the typed texts', async () => {
      const res = await request(http()).get(`/api/survey/surveys/${surveyId}/report/summary`).set(admin());
      expect(res.status).toBe(200);
      const fav = res.body.questions.find((q: { questionId: string }) => q.questionId === Q.fav);
      const other = fav.optionCounts.find((o: { value: string }) => o.value === '__other__');
      expect(other).toMatchObject({ label: 'Something else', count: 1 });
      expect(fav.otherAnswers).toEqual(['Comics']);
      const pick = res.body.questions.find((q: { questionId: string }) => q.questionId === Q.pick);
      expect(pick.optionCounts.find((o: { value: string }) => o.value === '__other__').count).toBe(1);
    });

    it('the dataset and the Excel export show "Other" answers as readable text', async () => {
      const dataset = await request(http()).get(`/api/survey/surveys/${surveyId}/report/dataset`).set(admin());
      expect(dataset.status).toBe(200);
      const texts = dataset.body.rows.flatMap((r: { answers: Record<string, unknown> }) => Object.values(r.answers)).map((v: unknown) => JSON.stringify(v));
      expect(texts.some((t: string) => t.includes('Something else: Comics') || t.includes('Other: Comics'))).toBe(true);
      expect(texts.some((t: string) => t.includes('__other__'))).toBe(false);

      const xlsx = await request(http()).get(`/api/survey/surveys/${surveyId}/responses/export`).set(admin()).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(xlsx.status).toBe(200);
      expect((xlsx.body as Buffer).length).toBeGreaterThan(500);
    });
  });

  describe('availability and finishing (phase C)', () => {
    const SEC = uuid(201);
    const QTEXT = uuid(202);
    let n = 0;

    /** A published one-question survey; `patch` is applied through the normal PATCH endpoint. */
    async function publishedSurvey(patch: Record<string, unknown> = {}): Promise<string> {
      const created = await request(http()).post('/api/survey/surveys').set(admin()).send({ title: `Phase C survey ${++n}` });
      const id = created.body.id as string;
      const structureBody = {
        sections: [{ id: uuid(300 + n * 2), orderIndex: 0, title: 'S', questions: [{ id: uuid(301 + n * 2), orderIndex: 0, type: 'short_text', title: 'Name', required: true }] }],
        logicRules: [],
      };
      expect((await request(http()).put(`/api/survey/surveys/${id}/structure`).set(admin()).send(structureBody)).status).toBe(200);
      if (Object.keys(patch).length) expect((await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send(patch)).status).toBe(200);
      expect([200, 201]).toContain((await request(http()).post(`/api/survey/surveys/${id}/publish`).set(admin())).status);
      return id;
    }
    const questionIdOf = async (id: string) => {
      const res = await request(http()).get(`/api/survey/surveys/${id}`).set(admin());
      return res.body.sections[0].questions[0].id as string;
    };
    const submit = async (id: string, value = 'x') =>
      request(http()).post(`/api/survey/public/${id}`).send({ answers: [{ questionId: await questionIdOf(id), value }] });
    void SEC;
    void QTEXT;

    it('refuses invalid settings: a zero limit and a closing date before the opening date', async () => {
      const id = await publishedSurvey();
      for (const body of [{ responseLimit: 0 }, { responseLimit: 2.5 }, { opensAt: '2030-02-01T00:00:00Z', closesAt: '2030-01-01T00:00:00Z' }]) {
        const res = await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send(body);
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
    });

    it('stores the thank-you message and progress bar and hands them to readers', async () => {
      const id = await publishedSurvey({ thankYouMessage: '  Thanks for reading!  ', showProgressBar: true });
      const detail = await request(http()).get(`/api/survey/surveys/${id}`).set(admin());
      expect(detail.body.settings).toEqual({ thankYouMessage: 'Thanks for reading!', showProgressBar: true });
      const fill = await request(http()).get(`/api/survey/public/${id}`);
      expect(fill.body.survey).toMatchObject({ thankYouMessage: 'Thanks for reading!', showProgressBar: true, isFull: false });

      // clearing one key keeps the other
      await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send({ thankYouMessage: '' });
      const after = await request(http()).get(`/api/survey/surveys/${id}`).set(admin());
      expect(after.body.settings).toEqual({ showProgressBar: true });
    });

    it('a survey that opens in the future answers "not open yet" to both opening and submitting, until the date is cleared', async () => {
      const opensAt = new Date(Date.now() + 86_400_000).toISOString();
      const id = await publishedSurvey({ opensAt });
      const get = await request(http()).get(`/api/survey/public/${id}`);
      expect(get.status).toBe(404);
      expect(get.body).toMatchObject({ notOpenYet: true, opensAt });
      expect((await submit(id)).status).toBe(404);

      expect((await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send({ opensAt: null })).status).toBe(200);
      expect((await request(http()).get(`/api/survey/public/${id}`)).status).toBe(200);
      expect((await submit(id)).status).toBe(201);
    });

    it('a survey whose closing date has passed is closed for readers, with the owner message', async () => {
      const id = await publishedSurvey({ closesAt: new Date(Date.now() + 60_000).toISOString(), closedMessage: 'Thanks, we are done.' });
      expect((await request(http()).get(`/api/survey/public/${id}`)).status).toBe(200);
      // move the closing moment into the past directly (the API only accepts a valid future-or-past date; use a past one)
      expect((await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send({ closesAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(200);
      const get = await request(http()).get(`/api/survey/public/${id}`);
      expect(get.status).toBe(404);
      expect(get.body).toMatchObject({ closed: true, ended: true, closedMessage: 'Thanks, we are done.' });
      expect((await submit(id)).status).toBe(404);
    });

    it('the response cap refuses new submissions with 409 {full:true}, flags the survey as full, and shows it in the list', async () => {
      const id = await publishedSurvey({ responseLimit: 2 });
      expect((await submit(id, 'a')).status).toBe(201);
      expect((await request(http()).get(`/api/survey/public/${id}`)).body.survey.isFull).toBe(false);
      expect((await submit(id, 'b')).status).toBe(201);

      const third = await submit(id, 'c');
      expect(third.status).toBe(409);
      expect(third.body).toMatchObject({ full: true });
      expect((await request(http()).get(`/api/survey/public/${id}`)).body.survey.isFull).toBe(true);

      const list = await request(http()).get('/api/survey/surveys').set(admin());
      const row = list.body.find((r: { id: string }) => r.id === id);
      expect(row).toMatchObject({ responseLimit: 2, responseCount: 2, availability: 'full' });

      // raising the cap reopens it
      await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send({ responseLimit: 3 });
      expect((await submit(id, 'd')).status).toBe(201);
    });

    it('simultaneous submissions can never exceed the cap (per-survey lock)', async () => {
      const id = await publishedSurvey({ responseLimit: 3 });
      const questionId = await questionIdOf(id);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => request(http()).post(`/api/survey/public/${id}`).send({ answers: [{ questionId, value: `r${i}` }] })),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
      const list = await request(http()).get('/api/survey/surveys').set(admin());
      expect(list.body.find((r: { id: string }) => r.id === id).responseCount).toBe(3);
    });

    it('duplicate and export/import carry the cap, the schedule and the settings', async () => {
      const id = await publishedSurvey({ responseLimit: 7, thankYouMessage: 'Cheers', showProgressBar: true });

      const copy = await request(http()).post(`/api/survey/surveys/${id}/duplicate`).set(admin()).send({});
      expect(copy.status).toBe(201);
      const copyDetail = await request(http()).get(`/api/survey/surveys/${copy.body.id}`).set(admin());
      expect(copyDetail.body).toMatchObject({ responseLimit: 7, settings: { thankYouMessage: 'Cheers', showProgressBar: true }, status: 'draft' });

      const zip = await request(http())
        .get(`/api/survey/surveys/${id}/export`)
        .set(admin())
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(zip.status).toBe(200);
      const imported = await request(http()).post('/api/survey/surveys/import').set(admin()).attach('file', zip.body as Buffer, 'survey.zip');
      expect(imported.status).toBe(201);
      const importedDetail = await request(http()).get(`/api/survey/surveys/${imported.body.id}`).set(admin());
      expect(importedDetail.body).toMatchObject({ responseLimit: 7, settings: { thankYouMessage: 'Cheers', showProgressBar: true } });
    });
  });
});
