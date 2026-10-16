import { jest } from '@jest/globals';
import { DynamicModule, ForwardReference, INestApplication, Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import JSZip from 'jszip';
import request from 'supertest';
import { AppModule } from '../../../../apps/api/src/app.module';
import { MigrationRunnerService } from '../../../../apps/api/src/core/module-registry/migration-runner.service';
import { ModuleRegistryService } from '../../../../apps/api/src/core/module-registry/module-registry.service';
import { NotificationEmailService } from '../../../../apps/api/src/core/notifications/notification-email.service';
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

  const mediaDir = mkdtempSync(join(tmpdir(), 'survey-media-'));

  beforeAll(async () => {
    process.env.SURVEY_MEDIA_DIR = mediaDir;
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
    rmSync(mediaDir, { recursive: true, force: true });
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

  describe('images (phase D)', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
    let n = 0;
    const files = () => readdirSync(mediaDir);
    const newSurvey = async () => {
      const res = await request(http()).post('/api/survey/surveys').set(admin()).send({ title: `Images ${++n}` });
      return res.body.id as string;
    };
    const upload = (id: string, bytes: Buffer = PNG, name = 'pic.png', type = 'image/png', headers: Record<string, string> = admin()) =>
      request(http()).post(`/api/survey/surveys/${id}/media`).set(headers).attach('file', bytes, { filename: name, contentType: type });
    const save = (id: string, section: Record<string, unknown>, question: Record<string, unknown> = {}) =>
      request(http())
        .put(`/api/survey/surveys/${id}/structure`)
        .set(admin())
        .send({
          sections: [
            {
              id: uuid(700 + n * 2),
              orderIndex: 0,
              title: 'S',
              ...section,
              questions: [{ id: uuid(701 + n * 2), orderIndex: 0, type: 'short_text', title: 'Q', ...question }],
            },
          ],
          logicRules: [],
        });

    it('stores a picture on disk and serves it publicly with safe headers', async () => {
      const id = await newSurvey();
      const up = await upload(id);
      expect(up.status).toBe(201);
      expect(up.body).toMatchObject({ mime: 'image/png', sizeBytes: PNG.length });
      expect(files()).toContain(`${up.body.mediaId}.png`);

      const res = await request(http()).get(`/api/survey/media/${up.body.mediaId}`); // no Authorization header
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['cache-control']).toContain('immutable');
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
    });

    it('rejects SVG, disguised files, GIF, empty and oversize uploads', async () => {
      const id = await newSurvey();
      const before = files().length;
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      expect((await upload(id, svg, 'x.svg', 'image/svg+xml')).status).toBe(400);
      expect((await upload(id, svg, 'x.png', 'image/png')).status).toBe(400); // lying about the type
      expect((await upload(id, Buffer.from('<html></html>'), 'x.png')).status).toBe(400);
      expect((await upload(id, Buffer.from('GIF89a......'), 'x.gif', 'image/gif')).status).toBe(400);
      const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
      expect((await upload(id, big)).status).toBe(413); // multer's own size limit
      expect((await request(http()).post(`/api/survey/surveys/${id}/media`).set(admin())).status).toBe(400);
      expect(files()).toHaveLength(before);
    });

    it('needs the survey-edit permission: anonymous 401, other roles 403, unknown survey 404', async () => {
      const id = await newSurvey();
      expect((await upload(id, PNG, 'p.png', 'image/png', {})).status).toBe(401);
      for (const role of ['reader', 'finance'] as const) {
        const token = (await fixtureForRole(app!, role)).token;
        expect((await upload(id, PNG, 'p.png', 'image/png', { Authorization: `Bearer ${token}` })).status).toBe(403);
      }
      expect((await upload(uuid(999999))).status).toBe(404);
      expect((await request(http()).get(`/api/survey/media/${uuid(999998)}`)).status).toBe(404);
      expect((await request(http()).get('/api/survey/media/not-a-uuid')).status).toBe(400);
    });

    it('is audited without the picture bytes', async () => {
      const id = await newSurvey();
      const up = await upload(id);
      const logs = await app!.get(PrismaService).$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM audit_log WHERE action = 'upload_image' AND entity_type = 'SurveyMedia'`);
      expect(Number(logs[0].n)).toBeGreaterThan(0);
      const leak = await app!.get(PrismaService).$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM audit_log WHERE new_value::text LIKE '%PNG%'`);
      expect(Number(leak[0].n)).toBe(0);
      expect(up.status).toBe(201);
    });

    it('a save may only use pictures of its own survey, with a description', async () => {
      const a = await newSurvey();
      const b = await newSurvey();
      const mine = (await upload(a)).body.mediaId as string;
      const theirs = (await upload(b)).body.mediaId as string;

      expect((await save(a, { image: { mediaId: theirs, alt: 'x' } })).status).toBe(400); // another survey's picture
      expect((await save(a, { image: { mediaId: uuid(555555), alt: 'x' } })).status).toBe(400); // never uploaded
      expect((await save(a, { image: { mediaId: mine, alt: '' } })).status).toBe(400); // no description
      expect((await save(a, {}, { config: { image: { mediaId: mine, alt: '' } } })).status).toBe(400);
      expect((await save(a, { image: { mediaId: '../../etc/passwd', alt: 'x' } })).status).toBe(400);
      expect((await request(http()).patch(`/api/survey/surveys/${a}`).set(admin()).send({ headerImage: { mediaId: theirs, alt: 'x' } })).status).toBe(400);

      expect((await save(a, { image: { mediaId: mine, alt: 'A shelf' } })).status).toBe(200);
    });

    it('header, section and question pictures reach the respondent', async () => {
      const id = await newSurvey();
      const [h, s, q] = [(await upload(id)).body.mediaId, (await upload(id)).body.mediaId, (await upload(id)).body.mediaId] as string[];
      expect((await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send({ headerImage: { mediaId: h, alt: 'Logo' } })).status).toBe(200);
      expect((await save(id, { image: { mediaId: s, alt: 'Reading room' } }, { config: { image: { mediaId: q, alt: 'Cover' } } })).status).toBe(200);
      expect([200, 201]).toContain((await request(http()).post(`/api/survey/surveys/${id}/publish`).set(admin())).status);

      const pub = await request(http()).get(`/api/survey/public/${id}`);
      expect(pub.status).toBe(200);
      expect(pub.body.survey.headerImage).toEqual({ mediaId: h, alt: 'Logo' });
      expect(pub.body.survey.sections[0].image).toEqual({ mediaId: s, alt: 'Reading room' });
      expect(pub.body.survey.sections[0].questions[0].config.image).toEqual({ mediaId: q, alt: 'Cover' });

      // removing the header picture clears the reference
      expect((await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send({ headerImage: null })).status).toBe(200);
      const after = await request(http()).get(`/api/survey/public/${id}`);
      expect(after.body.survey.headerImage).toBeNull();
    });

    it('cleans up pictures nothing uses any more, but keeps new uploads and used ones', async () => {
      const id = await newSurvey();
      const used = (await upload(id)).body.mediaId as string;
      const stale = (await upload(id)).body.mediaId as string;
      const fresh = (await upload(id)).body.mediaId as string;
      const prisma = app!.get(PrismaService);
      await prisma.$executeRawUnsafe(`UPDATE survey_media SET created_at = now() - interval '3 hours' WHERE id IN ('${used}','${stale}')`);

      expect((await save(id, { image: { mediaId: used, alt: 'Kept' } })).status).toBe(200);
      expect(files()).toContain(`${used}.png`);
      expect(files()).toContain(`${fresh}.png`); // uploaded a moment ago: the owner may not have clicked Save yet
      expect(files()).not.toContain(`${stale}.png`);
      expect((await request(http()).get(`/api/survey/media/${stale}`)).status).toBe(404);
    });

    it('deleting a survey deletes its picture files', async () => {
      const id = await newSurvey();
      const a = (await upload(id)).body.mediaId as string;
      expect(files()).toContain(`${a}.png`);
      expect((await request(http()).delete(`/api/survey/surveys/${id}`).set(admin())).status).toBeLessThan(300);
      expect(files()).not.toContain(`${a}.png`);
      expect((await request(http()).get(`/api/survey/media/${a}`)).status).toBe(404);
    });

    it('duplicate copies the pictures; export/import carries them in the zip', async () => {
      const id = await newSurvey();
      const [h, s, q] = [(await upload(id)).body.mediaId, (await upload(id)).body.mediaId, (await upload(id)).body.mediaId] as string[];
      await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send({ headerImage: { mediaId: h, alt: 'Logo' } });
      await save(id, { image: { mediaId: s, alt: 'Room' } }, { config: { image: { mediaId: q, alt: 'Cover' } } });

      const copy = await request(http()).post(`/api/survey/surveys/${id}/duplicate`).set(admin()).send({});
      expect(copy.status).toBe(201);
      const detail = (await request(http()).get(`/api/survey/surveys/${copy.body.id}`).set(admin())).body;
      const copied = [detail.settings.headerImage.mediaId, detail.sections[0].image.mediaId, detail.sections[0].questions[0].config.image.mediaId] as string[];
      expect(copied).not.toContain(h);
      expect(copied).not.toContain(s);
      expect(copied).not.toContain(q);
      for (const mediaId of copied) expect((await request(http()).get(`/api/survey/media/${mediaId}`)).status).toBe(200);
      expect(detail.settings.headerImage.alt).toBe('Logo');

      const zipRes = await request(http())
        .get(`/api/survey/surveys/${id}/export`)
        .set(admin())
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      const zip = await JSZip.loadAsync(zipRes.body as Buffer);
      expect(Object.keys(zip.files).filter((f) => f.startsWith('media/') && f.endsWith('.png'))).toHaveLength(3);

      const imported = await request(http()).post('/api/survey/surveys/import').set(admin()).attach('file', zipRes.body as Buffer, 'survey.zip');
      expect(imported.status).toBe(201);
      const importedDetail = (await request(http()).get(`/api/survey/surveys/${imported.body.id}`).set(admin())).body;
      const importedId = importedDetail.sections[0].image.mediaId as string;
      expect(importedId).not.toBe(s);
      const served = await request(http()).get(`/api/survey/media/${importedId}`);
      expect(served.status).toBe(200);
      expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    });

    it('an imported file that references a picture it does not contain simply loses that reference', async () => {
      const id = await newSurvey();
      const s = (await upload(id)).body.mediaId as string;
      await save(id, { image: { mediaId: s, alt: 'Room' } });
      const zipRes = await request(http())
        .get(`/api/survey/surveys/${id}/export`)
        .set(admin())
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      const zip = await JSZip.loadAsync(zipRes.body as Buffer);
      for (const f of Object.keys(zip.files).filter((x) => x.startsWith('media/'))) zip.remove(f);
      const stripped = await zip.generateAsync({ type: 'nodebuffer' });
      const imported = await request(http()).post('/api/survey/surveys/import').set(admin()).attach('file', stripped, 'survey.zip');
      expect(imported.status).toBe(201);
      const detail = (await request(http()).get(`/api/survey/surveys/${imported.body.id}`).set(admin())).body;
      expect(detail.sections[0].image).toBeNull();
    });
  });

  describe('piping and carry-forward (ext. F)', () => {
    let n = 0;
    const S1 = (k: number) => 900 + k * 10; // a number: the ids below are uuid(S1 + offset)
    /** Section 1: a multi-choice "genres" question. Section 2: a carry-forward question + a text question piping the answer. */
    async function build(mode: 'selected' | 'unselected', opts: { tokenTarget?: 'later' | 'same' | 'ok' } = {}) {
      const k = ++n;
      const created = await request(http()).post('/api/survey/surveys').set(admin()).send({ title: `Carry ${k}` });
      const id = created.body.id as string;
      const [sec1, sec2, qGenres, qFav, qWhy] = [0, 1, 2, 3, 4].map((offset) => uuid(S1(k) + offset));
      const opt = (i: number, value: string) => ({ id: uuid(5000 + k * 10 + i), orderIndex: i, value, label: value.toUpperCase() });
      const body = {
        sections: [
          {
            id: sec1,
            orderIndex: 0,
            title: 'Genres',
            questions: [{ id: qGenres, orderIndex: 0, type: 'multi_choice', title: 'Pick genres', options: [opt(0, 'fic'), opt(1, 'his'), opt(2, 'poe')] }],
          },
          {
            id: sec2,
            orderIndex: 1,
            title: opts.tokenTarget === 'same' ? `About {{q:${qFav}}}` : 'More',
            questions: [
              { id: qFav, orderIndex: 0, type: 'single_choice', title: 'Favourite', config: { optionsFrom: { questionId: qGenres, mode } } },
              { id: qWhy, orderIndex: 1, type: 'short_text', title: opts.tokenTarget === 'later' ? `Why {{q:${uuid(S1(k) + 9)}}}?` : `Why {{q:${qFav}}}?`, required: false },
            ],
          },
        ],
        logicRules: [],
      };
      return { id, body, ids: { qGenres, qFav, qWhy } };
    }
    const save = (id: string, body: unknown) => request(http()).put(`/api/survey/surveys/${id}/structure`).set(admin()).send(body as object);
    const publish = (id: string) => request(http()).post(`/api/survey/surveys/${id}/publish`).set(admin());
    const submit = (id: string, answers: Array<{ questionId: string; value: unknown }>) => request(http()).post(`/api/survey/public/${id}`).send({ answers });

    it('saves a question whose choices come from an earlier section', async () => {
      const { id, body } = await build('selected');
      // the piping token in section 2 points at a question of section 2 itself: refused
      const bad = await save(id, body);
      expect(bad.status).toBe(400);
      expect(String(bad.body.message)).toMatch(/earlier section/);
    });

    it('refuses tokens that point at a missing question or the same section, and bad carry-forward', async () => {
      const k = await build('selected', { tokenTarget: 'later' });
      expect((await save(k.id, k.body)).status).toBe(400);
      const sameSection = await build('selected');
      sameSection.body.sections[1].questions[1].title = 'Plain';
      sameSection.body.sections[1].questions[0].config = { optionsFrom: { questionId: sameSection.ids.qFav, mode: 'selected' } }; // itself
      expect((await save(sameSection.id, sameSection.body)).status).toBe(400);
      const wrongType = await build('selected');
      wrongType.body.sections[1].questions[1].title = 'Plain';
      wrongType.body.sections[1].questions[1].config = { optionsFrom: { questionId: wrongType.ids.qGenres, mode: 'selected' } }; // a text question
      expect((await save(wrongType.id, wrongType.body)).status).toBe(400);
    });

    async function valid(mode: 'selected' | 'unselected') {
      const built = await build(mode);
      built.body.sections[1].questions[1].title = `Why {{q:${built.ids.qGenres}}}?`; // pipe the earlier section's answer instead
      const saved = await save(built.id, built.body);
      expect(saved.status).toBe(200);
      expect([200, 201]).toContain((await publish(built.id)).status);
      return built;
    }

    it('the carried question accepts only the chosen options (selected) and rejects others', async () => {
      const { id, ids } = await valid('selected');
      const ok = await submit(id, [
        { questionId: ids.qGenres, value: ['fic', 'poe'] },
        { questionId: ids.qFav, value: 'poe' },
      ]);
      expect(ok.status).toBe(201);
      const notChosen = await submit(id, [
        { questionId: ids.qGenres, value: ['fic', 'poe'] },
        { questionId: ids.qFav, value: 'his' },
      ]);
      expect(notChosen.status).toBe(400);
      const unknown = await submit(id, [
        { questionId: ids.qGenres, value: ['fic'] },
        { questionId: ids.qFav, value: 'nonsense' },
      ]);
      expect(unknown.status).toBe(400);
    });

    it('unselected mode offers the options that were not ticked', async () => {
      const { id, ids } = await valid('unselected');
      expect((await submit(id, [{ questionId: ids.qGenres, value: ['fic', 'poe'] }, { questionId: ids.qFav, value: 'his' }])).status).toBe(201);
      expect((await submit(id, [{ questionId: ids.qGenres, value: ['fic', 'poe'] }, { questionId: ids.qFav, value: 'fic' }])).status).toBe(400);
    });

    it('a carried question with nothing to choose from is skipped, even when it is marked required', async () => {
      const built = await build('selected');
      built.body.sections[1].questions[1].title = 'Plain';
      built.body.sections[1].questions[0].required = true;
      expect((await save(built.id, built.body)).status).toBe(200);
      await publish(built.id);
      // the reader ticked nothing in the first question (it is optional) -> nothing is offered -> the carried question does not apply
      const res = await submit(built.id, [{ questionId: built.ids.qWhy, value: 'x' }]);
      expect(res.status).toBe(201);
      // and an answer sent for it anyway is dropped, not stored
      const sneaky = await submit(built.id, [{ questionId: built.ids.qFav, value: 'fic' }]);
      expect(sneaky.status).toBe(201);
      const responses = await request(http()).get(`/api/survey/surveys/${built.id}/responses`).set(admin());
      const stored = JSON.stringify(responses.body);
      expect(stored).not.toContain('fic');
    });

    it('the public survey exposes the carry-forward setting (the page does the substitution) and reports use the source options', async () => {
      const { id, ids } = await valid('selected');
      const pub = await request(http()).get(`/api/survey/public/${id}`);
      expect(pub.body.survey.sections[1].questions[0].config.optionsFrom).toEqual({ questionId: ids.qGenres, mode: 'selected' });
      await submit(id, [{ questionId: ids.qGenres, value: ['fic', 'poe'] }, { questionId: ids.qFav, value: 'poe' }]);
      const report = await request(http()).get(`/api/survey/surveys/${id}/report/summary`).set(admin());
      expect(report.status).toBe(200);
      const fav = (report.body.questions as Array<{ questionId: string; optionCounts?: Array<{ value: string; count: number }> }>).find((x) => x.questionId === ids.qFav)!;
      expect(fav.optionCounts?.find((o) => o.value === 'poe')?.count).toBe(1);
      expect(fav.optionCounts?.length).toBe(3);
    });

    it('duplicate keeps carry-forward working (ids are remapped inside the setting)', async () => {
      const { id } = await valid('selected');
      const copy = await request(http()).post(`/api/survey/surveys/${id}/duplicate`).set(admin()).send({});
      expect(copy.status).toBe(201);
      const detail = (await request(http()).get(`/api/survey/surveys/${copy.body.id}`).set(admin())).body;
      const sourceId = detail.sections[0].questions[0].id as string;
      const carried = detail.sections[1].questions[0].config.optionsFrom as { questionId: string };
      expect(carried.questionId).toBe(sourceId);
      expect(detail.sections[1].questions[1].title).toContain(`{{q:${sourceId}}}`);
    });
  });

  describe('co-owners (ext. G)', () => {
    let target: string;
    let other: string;
    const asRole = async (role: RoleCode) => ({ Authorization: `Bearer ${(await fixtureForRole(app!, role)).token}` });
    const emailOf = async (role: RoleCode) => (await fixtureForRole(app!, role)).email;
    const mk = async (title: string) => (await request(http()).post('/api/survey/surveys').set(admin()).send({ title })).body.id as string;
    const structure = (k: number) => ({
      sections: [{ id: uuid(7000 + k * 2), orderIndex: 0, title: 'S', questions: [{ id: uuid(7001 + k * 2), orderIndex: 0, type: 'short_text', title: 'Q' }] }],
      logicRules: [],
    });

    beforeAll(async () => {
      target = await mk('Shared survey');
      other = await mk('Not shared');
    });

    it('a user with no survey permissions is refused everything until they are made a co-owner', async () => {
      const reader = await asRole('reader');
      expect((await request(http()).patch(`/api/survey/surveys/${target}`).set(reader).send({ title: 'x' })).status).toBe(403);
      expect((await request(http()).put(`/api/survey/surveys/${target}/structure`).set(reader).send(structure(1))).status).toBe(403);
      expect((await request(http()).get(`/api/survey/surveys/${target}/report/summary`).set(reader)).status).toBe(403);
      expect((await request(http()).post(`/api/survey/surveys/${target}/publish`).set(reader)).status).toBe(403);
    });

    it('only the owner/share permission can add co-owners; unknown email → 404; the creator cannot be added', async () => {
      const reader = await asRole('reader');
      const refused = await request(http()).post(`/api/survey/surveys/${target}/collaborators`).set(reader).send({ email: await emailOf('reader') });
      expect(refused.status).toBe(403);
      expect((await request(http()).post(`/api/survey/surveys/${target}/collaborators`).set(admin()).send({ email: 'nobody@nowhere.example' })).status).toBe(404);
      expect((await request(http()).post(`/api/survey/surveys/${target}/collaborators`).set(admin()).send({ email: 'not-an-email' })).status).toBe(400);
      const adminEmail = (await fixtureForRole(app!, 'admin')).email;
      expect((await request(http()).post(`/api/survey/surveys/${target}/collaborators`).set(admin()).send({ email: adminEmail })).status).toBe(403);
    });

    it('a co-owner can edit, publish, read results and upload pictures of THAT survey only', async () => {
      const added = await request(http()).post(`/api/survey/surveys/${target}/collaborators`).set(admin()).send({ email: (await emailOf('reader')).toUpperCase() });
      expect(added.status).toBe(201);
      expect(added.body.coOwners.map((c: { email: string }) => c.email)).toContain(await emailOf('reader'));
      const reader = await asRole('reader');

      expect((await request(http()).patch(`/api/survey/surveys/${target}`).set(reader).send({ title: 'Renamed by co-owner' })).status).toBe(200);
      expect((await request(http()).put(`/api/survey/surveys/${target}/structure`).set(reader).send(structure(2))).status).toBe(200);
      expect([200, 201]).toContain((await request(http()).post(`/api/survey/surveys/${target}/publish`).set(reader)).status);
      expect((await request(http()).get(`/api/survey/surveys/${target}/responses`).set(reader)).status).toBe(200);
      expect((await request(http()).get(`/api/survey/surveys/${target}/report/summary`).set(reader)).status).toBe(200);
      expect((await request(http()).get(`/api/survey/surveys/${target}/report/dataset`).set(reader)).status).toBe(200);
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
      expect((await request(http()).post(`/api/survey/surveys/${target}/media`).set(reader).attach('file', png, 'a.png')).status).toBe(201);
      expect([200, 201]).toContain((await request(http()).post(`/api/survey/surveys/${target}/close`).set(reader)).status);

      // ...but not another survey, and not delete / archive / duplicate / managing co-owners
      expect((await request(http()).patch(`/api/survey/surveys/${other}`).set(reader).send({ title: 'x' })).status).toBe(403);
      expect((await request(http()).get(`/api/survey/surveys/${other}/responses`).set(reader)).status).toBe(403);
      expect((await request(http()).delete(`/api/survey/surveys/${target}`).set(reader)).status).toBe(403);
      expect((await request(http()).post(`/api/survey/surveys/${target}/archive`).set(reader)).status).toBe(403);
      expect((await request(http()).post(`/api/survey/surveys/${target}/duplicate`).set(reader).send({})).status).toBe(403);
      expect((await request(http()).post(`/api/survey/surveys/${target}/collaborators`).set(reader).send({ email: await emailOf('finance') })).status).toBe(403);
      expect((await request(http()).delete(`/api/survey/surveys/${target}/collaborators/${(await fixtureForRole(app!, 'reader')).userId}`).set(reader)).status).toBe(403);
    });

    it('a co-owner without the general view permission still cannot list or open other surveys', async () => {
      const reader = await asRole('reader');
      expect((await request(http()).get('/api/survey/surveys').set(reader)).status).toBe(403);
      expect((await request(http()).get(`/api/survey/surveys/${target}`).set(reader)).status).toBe(403);
    });

    it('the list and detail tell the UI what the caller may do', async () => {
      const list = await request(http()).get('/api/survey/surveys').set(admin());
      const row = list.body.find((r: { id: string }) => r.id === target);
      expect(row.access).toMatchObject({ canEdit: true, canPublish: true, canViewResults: true, canManageOwners: true, isCoOwner: false });
      const detail = await request(http()).get(`/api/survey/surveys/${target}`).set(admin());
      expect(detail.body.access.canManageOwners).toBe(true);
      const names = await request(http()).get(`/api/survey/surveys/${target}/collaborators`).set(admin());
      expect(names.body.owner.userId).toBe((await fixtureForRole(app!, 'admin')).userId);
      expect(names.body.coOwners).toHaveLength(1);
    });

    it('removing a co-owner takes the access away again, and it is all audited', async () => {
      const readerId = (await fixtureForRole(app!, 'reader')).userId;
      const removed = await request(http()).delete(`/api/survey/surveys/${target}/collaborators/${readerId}`).set(admin());
      expect(removed.status).toBe(200);
      expect(removed.body.coOwners).toHaveLength(0);
      const reader = await asRole('reader');
      expect((await request(http()).patch(`/api/survey/surveys/${target}`).set(reader).send({ title: 'again' })).status).toBe(403);
      const rows = await app!.get(PrismaService).$queryRawUnsafe<Array<{ action: string }>>(`SELECT action FROM audit_log WHERE entity_type = 'SurveyCollaborator'`);
      expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['add_co_owner', 'remove_co_owner']));
    });

    it('deleting the survey removes its co-owner rows', async () => {
      const gone = await mk('To delete');
      await request(http()).post(`/api/survey/surveys/${gone}/collaborators`).set(admin()).send({ email: await emailOf('finance') });
      expect((await request(http()).delete(`/api/survey/surveys/${gone}`).set(admin())).status).toBeLessThan(300);
      const rows = await app!.get(PrismaService).$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM survey_collaborators WHERE survey_id = '${gone}'`);
      expect(Number(rows[0].n)).toBe(0);
    });
  });

  describe('who may respond, invitations and emailed copies (ext. H)', () => {
    type Mail = { to: string; subject: string; text: string };
    let sent: Mail[];
    let n = 0;
    const asRole = async (role: RoleCode) => ({ Authorization: `Bearer ${(await fixtureForRole(app!, role)).token}` });
    const emailOf = async (role: RoleCode) => (await fixtureForRole(app!, role)).email;

    beforeEach(() => {
      sent = [];
      const mailer = app!.get(NotificationEmailService, { strict: false });
      jest.spyOn(mailer, 'send').mockImplementation(async (mail: Mail) => {
        sent.push(mail);
        return true;
      });
    });

    async function restrictedSurvey(patch: Record<string, unknown> = {}) {
      const k = ++n;
      const id = (await request(http()).post('/api/survey/surveys').set(admin()).send({ title: `Restricted ${k}` })).body.id as string;
      const questionId = uuid(8000 + k * 2 + 1);
      await request(http())
        .put(`/api/survey/surveys/${id}/structure`)
        .set(admin())
        .send({ sections: [{ id: uuid(8000 + k * 2), orderIndex: 0, title: 'S', questions: [{ id: questionId, orderIndex: 0, type: 'short_text', title: 'Name' }] }], logicRules: [] });
      expect((await request(http()).patch(`/api/survey/surveys/${id}`).set(admin()).send({ restricted: true, ...patch })).status).toBe(200);
      return { id, questionId };
    }
    const publish = (id: string) => request(http()).post(`/api/survey/surveys/${id}/publish`).set(admin());
    const audience = async (id: string) => (await request(http()).get(`/api/survey/surveys/${id}/audience`).set(admin())).body;
    const tokenFrom = (mail: Mail) => /[?&]invite=([^\s&]+)/.exec(mail.text)![1];
    const answer = (questionId: string, value = 'x') => ({ answers: [{ questionId, value }] });

    it('a restricted survey refuses strangers, anonymous and logged in', async () => {
      const { id, questionId } = await restrictedSurvey();
      await publish(id);
      const get = await request(http()).get(`/api/survey/public/${id}`);
      expect(get.status).toBe(403);
      expect(get.body.restricted).toBe(true);
      expect((await request(http()).post(`/api/survey/public/${id}`).send(answer(questionId))).status).toBe(403);
      expect((await request(http()).get(`/api/survey/${id}/fill`).set(await asRole('finance'))).status).toBe(403);
      expect((await request(http()).post(`/api/survey/${id}/fill`).set(await asRole('finance')).send(answer(questionId))).status).toBe(403);
      expect((await request(http()).get(`/api/survey/public/${id}?invite=garbage`)).status).toBe(403);
    });

    it('invitations need a published survey; bad addresses are reported, duplicates and repeats are not sent twice', async () => {
      const { id } = await restrictedSurvey();
      const draft = await request(http()).post(`/api/survey/surveys/${id}/invitations`).set(admin()).send({ emails: ['a@x.io'] });
      expect(draft.status).toBe(409);
      await publish(id);
      const res = await request(http())
        .post(`/api/survey/surveys/${id}/invitations`)
        .set(admin())
        .send({ emails: ['Ann@X.io, bob@x.io', 'not-an-email', 'ann@x.io', 'Cy <cy@x.io>'] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ invited: 3, alreadyInvited: 0, invalid: ['not-an-email'], sent: 3, failed: 0 });
      expect(sent.map((m) => m.to).sort()).toEqual(['ann@x.io', 'bob@x.io', 'cy@x.io']);
      expect(sent[0].subject).toContain('Restricted');
      const again = await request(http()).post(`/api/survey/surveys/${id}/invitations`).set(admin()).send({ emails: ['ann@x.io', 'dee@x.io'] });
      expect(again.body).toMatchObject({ invited: 1, alreadyInvited: 1 });
      expect(sent.filter((m) => m.to === 'ann@x.io')).toHaveLength(1);
      expect((await request(http()).post(`/api/survey/surveys/${id}/invitations`).set(admin()).send({ emails: ['nope'] })).status).toBe(400);
    });

    it('a personal link opens the survey once, marks the invitation, and cannot be reused', async () => {
      const { id, questionId } = await restrictedSurvey();
      await publish(id);
      await request(http()).post(`/api/survey/surveys/${id}/invitations`).set(admin()).send({ emails: ['ann@x.io'] });
      const token = tokenFrom(sent[0]);
      const invitedAs = async () => (await audience(id)).invitations.find((i: { email: string }) => i.email === 'ann@x.io');
      expect((await invitedAs()).status).toBe('invited');

      const opened = await request(http()).get(`/api/survey/public/${id}?invite=${token}`);
      expect(opened.status).toBe(200);
      expect((await invitedAs()).status).toBe('opened');

      const submitted = await request(http()).post(`/api/survey/public/${id}?invite=${token}`).send(answer(questionId, 'Ann'));
      expect(submitted.status).toBe(201);
      expect((await invitedAs()).status).toBe('responded');
      expect((await request(http()).post(`/api/survey/public/${id}?invite=${token}`).send(answer(questionId, 'Again'))).status).toBe(409);
      // the response is not linked to the address
      const responses = await request(http()).get(`/api/survey/surveys/${id}/responses`).set(admin());
      expect(JSON.stringify(responses.body)).not.toContain('ann@x.io');
      expect(responses.body).toHaveLength(1);
    });

    it('forged, foreign and revoked links are refused', async () => {
      const a = await restrictedSurvey();
      const b = await restrictedSurvey();
      await publish(a.id);
      await publish(b.id);
      await request(http()).post(`/api/survey/surveys/${a.id}/invitations`).set(admin()).send({ emails: ['ann@x.io'] });
      await request(http()).post(`/api/survey/surveys/${b.id}/invitations`).set(admin()).send({ emails: ['bob@x.io'] });
      const tokenA = tokenFrom(sent[0]);
      const tokenB = tokenFrom(sent[1]);
      const [idA, signature] = tokenA.split('.');
      expect((await request(http()).get(`/api/survey/public/${a.id}?invite=${idA}.${'0'.repeat(signature.length)}`)).status).toBe(403);
      expect((await request(http()).get(`/api/survey/public/${a.id}?invite=${tokenB}`)).status).toBe(403); // another survey's link
      expect((await request(http()).get(`/api/survey/public/${a.id}?invite=${tokenA}`)).status).toBe(200);
      const invitationId = (await audience(a.id)).invitations[0].id;
      expect((await request(http()).delete(`/api/survey/surveys/${a.id}/invitations/${invitationId}`).set(admin())).status).toBe(200);
      expect((await request(http()).get(`/api/survey/public/${a.id}?invite=${tokenA}`)).status).toBe(403); // revoked
    });

    it('allowed users and invited accounts can answer while logged in; others cannot', async () => {
      const { id, questionId } = await restrictedSurvey();
      await publish(id);
      const added = await request(http()).post(`/api/survey/surveys/${id}/audience/users`).set(admin()).send({ email: await emailOf('reader') });
      expect(added.status).toBe(201);
      expect((await request(http()).post(`/api/survey/surveys/${id}/audience/users`).set(admin()).send({ email: 'ghost@nowhere.example' })).status).toBe(404);
      expect((await request(http()).get(`/api/survey/${id}/fill`).set(await asRole('reader'))).status).toBe(200);
      expect((await request(http()).post(`/api/survey/${id}/fill`).set(await asRole('reader')).send(answer(questionId))).status).toBe(201);
      expect((await request(http()).get(`/api/survey/${id}/fill`).set(await asRole('library_assistant'))).status).toBe(403);
      // an invitation to finance's own email address works for that account when logged in, without the link
      await request(http()).post(`/api/survey/surveys/${id}/invitations`).set(admin()).send({ emails: [await emailOf('finance')] });
      expect((await request(http()).get(`/api/survey/${id}/fill`).set(await asRole('finance'))).status).toBe(200);
      expect((await request(http()).post(`/api/survey/${id}/fill`).set(await asRole('finance')).send(answer(questionId))).status).toBe(201);
      expect((await request(http()).post(`/api/survey/${id}/fill`).set(await asRole('finance')).send(answer(questionId))).status).toBe(409); // the invitation is used
      const removed = await request(http()).delete(`/api/survey/surveys/${id}/audience/users/${(await fixtureForRole(app!, 'reader')).userId}`).set(admin());
      expect(removed.status).toBe(200);
      expect((await request(http()).get(`/api/survey/${id}/fill`).set(await asRole('reader'))).status).toBe(403);
    });

    it('reminders go to people who have not answered, at most once a day', async () => {
      const { id, questionId } = await restrictedSurvey();
      await publish(id);
      await request(http()).post(`/api/survey/surveys/${id}/invitations`).set(admin()).send({ emails: ['ann@x.io', 'bob@x.io'] });
      const annToken = tokenFrom(sent.find((m) => m.to === 'ann@x.io')!);
      await request(http()).post(`/api/survey/public/${id}?invite=${annToken}`).send(answer(questionId));
      sent.length = 0;
      const first = await request(http()).post(`/api/survey/surveys/${id}/invitations/remind`).set(admin());
      expect(first.body).toMatchObject({ reminded: 1, failed: 0 });
      expect(sent.map((m) => m.to)).toEqual(['bob@x.io']);
      expect(sent[0].subject).toMatch(/Reminder/);
      const bobToken = tokenFrom(sent[0]);
      expect((await request(http()).get(`/api/survey/public/${id}?invite=${bobToken}`)).status).toBe(200); // the reminder carries a working link
      expect((await request(http()).post(`/api/survey/surveys/${id}/invitations/remind`).set(admin())).body.reminded).toBe(0);
      const bob = (await audience(id)).invitations.find((i: { email: string }) => i.email === 'bob@x.io');
      expect(bob.reminderCount).toBe(1);
    });

    it('managing the audience needs edit rights on the survey: strangers 403, co-owners allowed', async () => {
      const { id } = await restrictedSurvey();
      await publish(id);
      const reader = await asRole('reader');
      expect((await request(http()).get(`/api/survey/surveys/${id}/audience`).set(reader)).status).toBe(403);
      expect((await request(http()).post(`/api/survey/surveys/${id}/invitations`).set(reader).send({ emails: ['a@x.io'] })).status).toBe(403);
      expect((await request(http()).post(`/api/survey/surveys/${id}/invitations/remind`).set(reader)).status).toBe(403);
      expect((await request(http()).post(`/api/survey/surveys/${id}/audience/users`).set(reader).send({ email: await emailOf('finance') })).status).toBe(403);
      await request(http()).post(`/api/survey/surveys/${id}/collaborators`).set(admin()).send({ email: await emailOf('reader') });
      expect((await request(http()).post(`/api/survey/surveys/${id}/invitations`).set(reader).send({ emails: ['co@x.io'] })).status).toBe(201);
      expect((await request(http()).get(`/api/survey/surveys/${id}/audience`).set(reader)).status).toBe(200);
    });

    it('the audit trail records invitations without copying the address list', async () => {
      const rows = await app!.get(PrismaService).$queryRawUnsafe<Array<{ action: string; new_value: unknown }>>(`SELECT action, new_value FROM audit_log WHERE entity_type = 'SurveyInvitation'`);
      expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['invite', 'remind']));
      expect(JSON.stringify(rows.map((r) => r.new_value))).not.toMatch(/"invitations":\[/);
    });

    it('emails a copy of the answers: to the account, to the invited address, or to an address a public respondent typed', async () => {
      const open = await restrictedSurvey({ restricted: false, emailCopy: true });
      await publish(open.id);
      const typed = await request(http()).post(`/api/survey/public/${open.id}`).send({ ...answer(open.questionId, 'Hello'), copyToEmail: 'me@x.io' });
      expect(typed.status).toBe(201);
      const mail = sent.find((m) => m.to === 'me@x.io')!;
      expect(mail.subject).toContain('Your answers');
      expect(mail.text).toContain('Name');
      expect(mail.text).toContain('Hello');
      // nothing is sent when the respondent gives no address
      sent.length = 0;
      await request(http()).post(`/api/survey/public/${open.id}`).send(answer(open.questionId));
      expect(sent).toHaveLength(0);

      // a logged-in respondent gets it at the account address, whatever they typed
      sent.length = 0;
      await request(http()).post(`/api/survey/${open.id}/fill`).set(await asRole('finance')).send({ ...answer(open.questionId, 'Fin'), copyToEmail: 'attacker@x.io' });
      expect(sent.map((m) => m.to)).toEqual([await emailOf('finance')]);

      // an invited respondent gets it at the invited address, whatever they typed
      const inv = await restrictedSurvey({ emailCopy: true });
      await publish(inv.id);
      await request(http()).post(`/api/survey/surveys/${inv.id}/invitations`).set(admin()).send({ emails: ['ann@x.io'] });
      const token = tokenFrom(sent[sent.length - 1]);
      sent.length = 0;
      await request(http()).post(`/api/survey/public/${inv.id}?invite=${token}`).send({ ...answer(inv.questionId, 'Ann'), copyToEmail: 'attacker@x.io' });
      expect(sent.map((m) => m.to)).toEqual(['ann@x.io']);

      // survey option off -> no copy even with an address
      const off = await restrictedSurvey({ restricted: false });
      await publish(off.id);
      sent.length = 0;
      await request(http()).post(`/api/survey/public/${off.id}`).send({ ...answer(off.questionId), copyToEmail: 'me@x.io' });
      expect(sent).toHaveLength(0);
    });

    it('the public survey says whether it offers a copy; duplicate keeps the restriction with an empty audience', async () => {
      const { id } = await restrictedSurvey({ emailCopy: true });
      await publish(id);
      const copy = await request(http()).post(`/api/survey/surveys/${id}/duplicate`).set(admin()).send({});
      const detail = (await request(http()).get(`/api/survey/surveys/${copy.body.id}`).set(admin())).body;
      expect(detail.settings).toMatchObject({ restricted: true, emailCopy: true });
      expect((await audience(copy.body.id)).invitations).toEqual([]);
      const open = await restrictedSurvey({ restricted: false, emailCopy: true });
      await publish(open.id);
      expect((await request(http()).get(`/api/survey/public/${open.id}`)).body.survey.emailCopy).toBe(true);
    });
  });
});
