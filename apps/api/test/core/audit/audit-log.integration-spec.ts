import type { INestApplication } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { AuditLogWriter } from '../../../src/core/audit/audit-log.writer';
import { AuditService } from '../../../src/core/audit/audit.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { createTestApp } from '../../support/bootstrap-app';
import { startPostgresTestContainer, stopPostgresTestContainer } from '../../support/postgres-test-container';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Tier 2: everything about `audit_log` that only a REAL Postgres proves —
 * a JSON diff genuinely round-trips through a real JSONB column, redaction
 * survives that round-trip, the purge boundary math is evaluated against
 * REAL row timestamps (not a mocked `deleteMany` that can be told it
 * "deleted 3 rows" without any rows existing), and — the one Tier 1 flatly
 * cannot touch at all — the DB-level `CHECK (actor_type <> 'user' OR
 * actor_user_id IS NOT NULL)` constraint (0005_create_audit_log.sql) really
 * rejects a bad insert. AuditLogWriter.write() deliberately swallows every
 * error (so a broken audit write never corrupts the response that triggered
 * it), so proving the constraint means going around it with a raw
 * `prisma.auditLog.create()` call.
 */
describe('audit_log (integration, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let auditService: AuditService;
  let auditLogWriter: AuditLogWriter;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    auditService = app.get(AuditService);
    auditLogWriter = app.get(AuditLogWriter);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await stopPostgresTestContainer(container);
  });

  it('a real write produces a row whose old/new JSON diff round-trips correctly and redacts @Sensitive fields', async () => {
    const entityId = randomUUID();
    await auditLogWriter.write({
      actorType: 'user',
      actorUserId: randomUUID(),
      category: 'core.users',
      entityType: 'User',
      entityId,
      action: 'update',
      oldValue: { name: 'Old Name', passwordHash: 'argon2-old-hash-should-never-appear' },
      newValue: { name: 'New Name', passwordHash: 'argon2-new-hash-should-never-appear' },
    });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'User', entityId } });
    expect(row.oldValue).toMatchObject({ name: 'Old Name', passwordHash: '[redacted]' });
    expect(row.newValue).toMatchObject({ name: 'New Name', passwordHash: '[redacted]' });
    expect(JSON.stringify(row.oldValue)).not.toContain('argon2-old-hash-should-never-appear');
    expect(JSON.stringify(row.newValue)).not.toContain('argon2-new-hash-should-never-appear');
  });

  describe('purge() boundary', () => {
    it('rejects a cutoff of today (UTC) and leaves every row untouched', async () => {
      const todayStr = utcDateString(new Date());
      const before = await prisma.auditLog.count();

      await expect(
        auditService.purge(todayStr, { userId: randomUUID(), sessionId: randomUUID(), ipAddress: null, userAgent: null }),
      ).rejects.toThrow(BadRequestException);

      expect(await prisma.auditLog.count()).toBe(before);
    });

    it('a cutoff of yesterday deletes exactly the rows strictly older than that boundary, using REAL timestamps', async () => {
      const now = new Date();
      const todayUtcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const yesterdayUtcStart = todayUtcStart - DAY_MS;
      const marker = randomUUID();

      // One row strictly before the cutoff, one row exactly at/after it (the
      // boundary must be `<`, never `<=`, per ARCHITECTURE.md §8.4).
      const oldRow = await prisma.auditLog.create({
        data: {
          occurredAt: new Date(yesterdayUtcStart - 1_000),
          actorType: 'system',
          category: 'core.test',
          entityType: 'PurgeMarker',
          entityId: marker,
          action: 'old',
        },
      });
      const survivorRow = await prisma.auditLog.create({
        data: {
          occurredAt: new Date(yesterdayUtcStart + 1_000),
          actorType: 'system',
          category: 'core.test',
          entityType: 'PurgeMarker',
          entityId: marker,
          action: 'survivor',
        },
      });

      const result = await auditService.purge(utcDateString(new Date(yesterdayUtcStart)), {
        userId: randomUUID(),
        sessionId: randomUUID(),
        ipAddress: '198.51.100.5',
        userAgent: 'integration-test',
      });

      expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);

      expect(await prisma.auditLog.findUnique({ where: { id: oldRow.id } })).toBeNull();
      expect(await prisma.auditLog.findUnique({ where: { id: survivorRow.id } })).not.toBeNull();

      // The purge's own audit row is written AFTER the delete, with the
      // actual deleted-row count — never itself untraceable.
      const purgeRow = await prisma.auditLog.findFirstOrThrow({
        where: { category: 'core.audit', action: 'purge' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(purgeRow.actorType).toBe(ActorType.user);
      expect((purgeRow.newValue as { rowsDeleted: number }).rowsDeleted).toBe(result.rowsDeleted);
    });
  });

  it('the DB-level CHECK constraint really rejects an actor_type=user row with no actor_user_id', async () => {
    const before = await prisma.auditLog.count();

    await expect(
      prisma.auditLog.create({
        data: {
          actorType: ActorType.user,
          actorUserId: null,
          category: 'core.test',
          entityType: 'ConstraintProbe',
          action: 'create',
        },
      }),
    ).rejects.toThrow();

    // The CHECK failure rolled back the insert entirely.
    expect(await prisma.auditLog.count()).toBe(before);
  });
});
