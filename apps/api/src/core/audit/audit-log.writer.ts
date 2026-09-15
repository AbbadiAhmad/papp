import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { redactSensitive } from '../../common/sensitive/sensitive-fields';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogEntry {
  actorType: ActorType;
  /** Required when actorType === 'user' (DB CHECK enforces it too). */
  actorUserId?: string | null;
  actorSessionId?: string | null;
  category: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * The single funnel every `audit_log` row goes through — the global
 * AuditInterceptor, AuthService's direct login/logout rows, SettingsService
 * writes and the purge's own self-row all call `write()`. It applies
 * @Sensitive redaction to old/new values unconditionally (so no caller can
 * forget it) and NEVER throws: a failed audit write must not corrupt the
 * response that triggered it, but it IS loudly logged (ARCHITECTURE.md §8.2,
 * BUILD_PLAN.md Phase 3).
 */
@Injectable()
export class AuditLogWriter {
  private readonly logger = new Logger(AuditLogWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: entry.actorType,
          actorUserId: entry.actorUserId ?? null,
          actorSessionId: entry.actorSessionId ?? null,
          category: entry.category,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          action: entry.action,
          oldValue: this.toJsonColumn(entry.oldValue),
          newValue: this.toJsonColumn(entry.newValue),
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error) {
      // Loud, structured, impossible to miss in logs — but the original
      // request's response is already on its way and must not be corrupted.
      this.logger.error(
        `FAILED to write audit_log row (category=${entry.category}, entityType=${entry.entityType}, ` +
          `action=${entry.action}, entityId=${entry.entityId ?? 'null'}, actorUserId=${entry.actorUserId ?? 'null'}). ` +
          'The action itself succeeded but is now UNAUDITED — investigate immediately.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Redacts @Sensitive fields and normalizes to a JSON-plain structure in one
   * pass — redaction at the serialization layer itself (§8.3), the last stop
   * before the value reaches the driver.
   */
  private toJsonColumn(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return redactSensitive(value) as Prisma.InputJsonValue;
  }
}
