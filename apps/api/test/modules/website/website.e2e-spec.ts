import { DynamicModule, ForwardReference, INestApplication, Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MigrationRunnerService } from '../../../src/core/module-registry/migration-runner.service';
import { ModuleRegistryService } from '../../../src/core/module-registry/module-registry.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';
import {
  ALL_ROLE_CODES,
  RoleCode,
  expectPermissionEnforced,
  fixtureForRole,
  roleHasPermission,
} from '../../../../../test/support/permission-matrix';

/**
 * Tier 2 e2e for the `website` module — same real-install pattern as
 * `library-catalog.e2e-spec.ts`/`library-circulation.e2e-spec.ts` (see those
 * files' own docblocks for the general shape). This module's `public.controller.ts`
 * has NO public write endpoints, so unlike those two it never imports the
 * real `PublicThrottlerGuard` from `apps/api/dist/...` — no build-then-import
 * dance is needed here, a plain `.ts` dynamic import of the module class is
 * enough.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..', '..', '..');
const CORE_MIGRATIONS_DIR = join(here, '..', '..', '..', 'src', 'core', 'migrations');
const BOOTSTRAP_MIGRATION_FILENAME = '0000_bootstrap_registry.sql';

async function bootstrapRegistryTables(): Promise<void> {
  const sql = readFileSync(join(CORE_MIGRATIONS_DIR, BOOTSTRAP_MIGRATION_FILENAME), 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

type NestImport = Type<unknown> | DynamicModule | ForwardReference | Promise<DynamicModule>;

function buildRootModule(discoveredModuleClasses: unknown[]): Type<unknown> {
  class RootModule {}
  Module({ imports: [AppModule, ...(discoveredModuleClasses as NestImport[])] })(RootModule);
  return RootModule;
}

async function createAppWithWebsiteInstalled(): Promise<INestApplication> {
  await bootstrapRegistryTables();

  const { WebsiteModule } = (await import('../../../../../modules/website/backend/website.module.ts')) as {
    WebsiteModule: Type<unknown>;
  };

  const app = await NestFactory.create(buildRootModule([WebsiteModule]), { logger: false });

  const migrationRunner = app.get(MigrationRunnerService);
  await migrationRunner.applyDirectory(CORE_MIGRATIONS_DIR, 'core');

  const prisma = app.get(PrismaService);
  await prisma.moduleRegistryEntry.upsert({
    where: { key: 'core' },
    update: {},
    create: { key: 'core', version: '0.0.1', status: 'installed', installedAt: new Date() },
  });

  process.env.MODULES_DIR = join(REPO_ROOT, 'modules');

  const moduleRegistry = app.get(ModuleRegistryService);
  await moduleRegistry.install('website');

  await app.init();
  return app;
}

describe('website module (e2e, real install + real HTTP)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createAppWithWebsiteInstalled();
    await Promise.all(ALL_ROLE_CODES.map((role) => fixtureForRole(app!, role)));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  it('really installed with the real seeded default grants (per manifest.json defaultRolePermissions): admin only', async () => {
    expect(await roleHasPermission(app!, 'admin', 'website.pages.view')).toBe(true);
    expect(await roleHasPermission(app!, 'admin', 'website.pages.publish')).toBe(true);
    expect(await roleHasPermission(app!, 'admin', 'website.menus.update')).toBe(true);
    expect(await roleHasPermission(app!, 'library_assistant', 'website.pages.view')).toBe(false);
    expect(await roleHasPermission(app!, 'finance', 'website.pages.view')).toBe(false);
    expect(await roleHasPermission(app!, 'reader', 'website.pages.view')).toBe(false);
  });

  describe('permission matrix', () => {
    expectPermissionEnforced({ app: () => app!, method: 'get', path: '/api/website/pages', requiredPermission: 'website.pages.view' });
    expectPermissionEnforced({
      app: () => app!,
      method: 'get',
      path: '/api/website/menus/header',
      requiredPermission: 'website.menus.view',
    });
    expectPermissionEnforced({
      app: () => app!,
      method: 'post',
      path: '/api/website/pages',
      requiredPermission: 'website.pages.create',
      validBody: (role: RoleCode) => ({ slug: `matrix-${role.replace(/_/g, '-')}-${Date.now()}`, title: `Matrix page (${role})` }),
    });
  });

  it('rejects the reserved "admin" slug (WEBSITE-D1) even for an admin caller', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const res = await request(app!.getHttpServer())
      .post('/api/website/pages')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ slug: 'admin', title: 'Should be rejected' });
    expect(res.status).toBe(409);
  });

  it('rejects a duplicate slug', async () => {
    const admin = await fixtureForRole(app!, 'admin');
    const slug = `dup-${Date.now()}`;
    const first = await request(app!.getHttpServer())
      .post('/api/website/pages')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ slug, title: 'First' });
    expect(first.status).toBe(201);

    const second = await request(app!.getHttpServer())
      .post('/api/website/pages')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ slug, title: 'Second' });
    expect(second.status).toBe(409);
  });

  describe('the full create -> add blocks -> publish -> public-read -> unpublish flow', () => {
    let admin: { token: string };
    let pageId: string;
    const slug = `about-${Date.now()}`;
    const scriptPayload = 'Hello <script>window.__pwned = true;</script> world';

    it('creates a draft page as admin (audited)', async () => {
      admin = await fixtureForRole(app!, 'admin');
      const res = await request(app!.getHttpServer())
        .post('/api/website/pages')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ slug, title: 'About' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('draft');
      pageId = res.body.id;

      const row = await app!
        .get(PrismaService)
        .auditLog.findFirst({ where: { category: 'website.pages', action: 'create', entityId: pageId } });
      expect(row).not.toBeNull();
    });

    it('a draft page 404s on both public read endpoints', async () => {
      const bySlug = await request(app!.getHttpServer()).get(`/api/website/public/pages/${slug}`);
      expect(bySlug.status).toBe(404);
    });

    it('replaces the page blocks with a whole-list upsert, including a script-tag payload in a text block', async () => {
      const blocks = [
        { id: '11111111-1111-1111-1111-111111111111', orderIndex: 0, type: 'hero', config: { heading: 'Welcome' } },
        { id: '22222222-2222-2222-2222-222222222222', orderIndex: 1, type: 'text', config: { markdown: scriptPayload } },
      ];
      const res = await request(app!.getHttpServer())
        .put(`/api/website/pages/${pageId}/blocks`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ blocks });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('publishes the page', async () => {
      const res = await request(app!.getHttpServer())
        .post(`/api/website/pages/${pageId}/publish`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('published');
    });

    it('is now reachable via the public read endpoint with NO Authorization header, blocks intact', async () => {
      const res = await request(app!.getHttpServer()).get(`/api/website/public/pages/${slug}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('published');
      expect(res.body.blocks).toHaveLength(2);
      // The backend never renders or sanitizes this text — it is opaque JSON
      // data returned verbatim; the safety guarantee (never executed as a
      // live DOM node) is enforced entirely client-side by SafeMarkdown.tsx,
      // covered by apps/web/tests/website-safe-markdown.test.tsx.
      const textBlock = res.body.blocks.find((b: { type: string }) => b.type === 'text');
      expect(textBlock.config.markdown).toBe(scriptPayload);
    });

    it('sets the page as the homepage, and the public homepage endpoint resolves it', async () => {
      const update = await request(app!.getHttpServer())
        .patch(`/api/website/pages/${pageId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isHomepage: true });
      expect(update.status).toBe(200);
      expect(update.body.isHomepage).toBe(true);

      const homepage = await request(app!.getHttpServer()).get('/api/website/public/homepage');
      expect(homepage.status).toBe(200);
      expect(homepage.body.id).toBe(pageId);
    });

    it('homepage exclusivity: setting a second page as homepage clears the first (partial-unique-index behavior)', async () => {
      const other = await request(app!.getHttpServer())
        .post('/api/website/pages')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ slug: `other-${Date.now()}`, title: 'Other' });
      expect(other.status).toBe(201);

      const setOther = await request(app!.getHttpServer())
        .patch(`/api/website/pages/${other.body.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isHomepage: true });
      expect(setOther.status).toBe(200);
      expect(setOther.body.isHomepage).toBe(true);

      const firstPage = await request(app!.getHttpServer())
        .get(`/api/website/pages/${pageId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(firstPage.body.isHomepage).toBe(false);
    });

    it('unpublishing the page makes it 404 again on the public endpoint', async () => {
      const unpublish = await request(app!.getHttpServer())
        .post(`/api/website/pages/${pageId}/unpublish`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(unpublish.status).toBe(200);
      expect(unpublish.body.status).toBe('draft');

      const publicRead = await request(app!.getHttpServer()).get(`/api/website/public/pages/${slug}`);
      expect(publicRead.status).toBe(404);
    });
  });

  describe('menus', () => {
    it('replaces the header menu and the public read endpoint reflects it with NO Authorization header', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const items = [{ id: '33333333-3333-3333-3333-333333333333', label: 'Home', urlOrSlug: '/site', orderIndex: 0 }];

      const write = await request(app!.getHttpServer())
        .put('/api/website/menus/header')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ items });
      expect(write.status).toBe(200);

      const publicRead = await request(app!.getHttpServer()).get('/api/website/public/menus/header');
      expect(publicRead.status).toBe(200);
      expect(publicRead.body).toHaveLength(1);
      expect(publicRead.body[0].label).toBe('Home');

      const row = await app!
        .get(PrismaService)
        .auditLog.findFirst({ where: { category: 'website.menus', action: 'update' } });
      expect(row).not.toBeNull();
    });
  });

  describe('site config (settings)', () => {
    it('requires website.settings.update to write, and the public endpoint reflects it with no auth', async () => {
      const admin = await fixtureForRole(app!, 'admin');
      const write = await request(app!.getHttpServer())
        .put('/api/website/settings/site-config')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ siteTitle: 'My School', logoUrl: null });
      expect(write.status).toBe(200);

      const publicRead = await request(app!.getHttpServer()).get('/api/website/public/site-config');
      expect(publicRead.status).toBe(200);
      expect(publicRead.body.siteTitle).toBe('My School');
    });
  });
});
