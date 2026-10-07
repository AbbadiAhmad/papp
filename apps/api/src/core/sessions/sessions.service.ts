import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditLogWriter } from '../audit/audit-log.writer';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicSession, toPublicSession } from './session.presenter';

/** Sessions can only be purged once they are at least this many days old (UTC). */
export const SESSION_PURGE_MIN_AGE_DAYS = 3;

export interface SessionPurgeActor {
  userId: string;
  sessionId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SessionPurgeResult {
  cutoffDate: string;
  rowsDeleted: number;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogWriter: AuditLogWriter,
  ) {}

  async listForUser(userId: string): Promise<PublicSession[]> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId },
      include: { user: { select: { name: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    return sessions.map(toPublicSession);
  }

  /**
   * Force-revokes a session (admin "force logout"). Idempotent: revoking an
   * already-revoked session is a no-op, not an error.
   */
  async revoke(sessionId: string): Promise<void> {
    const session = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    if (session.revokedAt) {
      return;
    }
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Manual purge of old sessions, modelled on AuditService.purge (D25).
   * The cutoff is capped at `SESSION_PURGE_MIN_AGE_DAYS` days before today
   * (UTC) — a `cutoffDate` later than that is rejected. Only ENDED sessions
   * (revoked, or past `expires_at`) issued before the cutoff are deleted, so
   * purging can never silently sign anyone out. The purge's own audit row is
   * written after the delete, with the real deleted-row count.
   */
  async purge(cutoffDate: string, actor: SessionPurgeActor): Promise<SessionPurgeResult> {
    const cutoff = new Date(`${cutoffDate}T00:00:00.000Z`);
    if (Number.isNaN(cutoff.getTime()) || cutoff.toISOString().slice(0, 10) !== cutoffDate) {
      throw new BadRequestException(`cutoffDate "${cutoffDate}" is not a valid calendar date`);
    }

    const now = new Date();
    const maxCutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - SESSION_PURGE_MIN_AGE_DAYS);
    if (cutoff.getTime() > maxCutoff) {
      throw new BadRequestException(
        `cutoffDate must be ${SESSION_PURGE_MIN_AGE_DAYS} days before today (UTC) or earlier — newer sessions can never be purged`,
      );
    }

    const { count } = await this.prisma.userSession.deleteMany({
      where: {
        issuedAt: { lt: cutoff },
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }],
      },
    });

    this.logger.warn(`Session purge by user ${actor.userId}: deleted ${count} user_sessions row(s) issued before ${cutoffDate}T00:00:00Z`);

    await this.auditLogWriter.write({
      actorType: 'user',
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      category: 'core.sessions',
      entityType: 'UserSession',
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
