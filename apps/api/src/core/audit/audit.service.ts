import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogWriter } from './audit-log.writer';
import { QueryAuditDto } from './dto/query-audit.dto';

const DEFAULT_PAGE_SIZE = 50;

export interface AuditPage {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PurgeActor {
  userId: string;
  sessionId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PurgeResult {
  cutoffDate: string;
  rowsDeleted: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogWriter: AuditLogWriter,
  ) {}

  /**
   * Rows come straight off the table — old/new values were already passed
   * through @Sensitive redaction by AuditLogWriter when they were written,
   * so there is nothing further to strip here.
   */
  async query(dto: QueryAuditDto): Promise<AuditPage> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? DEFAULT_PAGE_SIZE;

    const occurredAt: Prisma.DateTimeFilter = {};
    if (dto.from) occurredAt.gte = new Date(dto.from);
    if (dto.to) occurredAt.lte = new Date(dto.to);

    const where: Prisma.AuditLogWhereInput = {
      category: dto.category,
      entityType: dto.entityType,
      actorUserId: dto.actorUserId,
      ...(dto.from || dto.to ? { occurredAt } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * Manual purge (D25 / ARCHITECTURE.md §8.4): deletes every row with
   * `occurred_at < cutoff`, where the cutoff is capped at YESTERDAY —
   * strictly reject any `cutoffDate >= today`, evaluated in UTC
   * (BUILD_PLAN.md risk #5; UTC because D7 pins Gregorian everywhere and a
   * server-local "today" would make the cap ambiguous). With the strict
   * `<` on both the cap and the delete, at least one full day of entries
   * (all of yesterday + today) always survives.
   *
   * The purge's OWN audit row is written AFTER the delete completes —
   * deliberately not before, and not in a shared transaction that a failed
   * delete could roll it back with — recording the ACTUAL deleted-row count,
   * so the purge is never itself untraceable.
   */
  async purge(cutoffDate: string, actor: PurgeActor): Promise<PurgeResult> {
    const cutoff = new Date(`${cutoffDate}T00:00:00.000Z`);
    if (Number.isNaN(cutoff.getTime())) {
      throw new BadRequestException(`cutoffDate "${cutoffDate}" is not a valid calendar date`);
    }

    const now = new Date();
    const todayStartUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (cutoff.getTime() >= todayStartUtc) {
      throw new BadRequestException(
        'cutoffDate must be yesterday (UTC) or earlier — the most recent day of audit entries can never be purged (D25)',
      );
    }

    const { count } = await this.prisma.auditLog.deleteMany({
      where: { occurredAt: { lt: cutoff } },
    });

    this.logger.warn(
      `Audit purge by user ${actor.userId}: deleted ${count} audit_log row(s) older than ${cutoffDate}T00:00:00Z`,
    );

    // AFTER the delete (see docblock). AuditLogWriter never throws, so a
    // failed self-row write cannot make the (already-committed) purge fail —
    // it is loudly logged instead.
    await this.auditLogWriter.write({
      actorType: 'user',
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      category: 'core.audit',
      entityType: 'AuditLog',
      entityId: null,
      action: 'purge',
      oldValue: null,
      newValue: { cutoffDate, rowsDeleted: count },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { cutoffDate, rowsDeleted: count };
  }
}
