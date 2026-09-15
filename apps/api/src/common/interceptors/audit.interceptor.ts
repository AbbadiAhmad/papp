import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AuditLogWriter } from '../../core/audit/audit-log.writer';
import { extractRequestMeta } from '../../core/auth/request-meta.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { AUDIT_KEY, AuditMetadata } from '../decorators/audit.decorator';

/**
 * Globally-applied (APP_INTERCEPTOR in AppModule — opt-out not opt-in, per
 * ARCHITECTURE.md §8.2): any handler carrying `@Audit({...})` metadata gets
 * an `audit_log` row written after it succeeds. Handlers without the
 * metadata pass through untouched, as do handlers that throw (a failed
 * mutation changed nothing, so there is nothing to audit — login *attempts*
 * are not in scope per §8.2, which only requires login/logout events,
 * written directly by AuthService).
 *
 * Actor resolution (BUILD_PLAN.md risk #6):
 *  - `request.user` present  → actorType 'user' (guards run before
 *    interceptors, so JwtAuthGuard has already populated it).
 *  - no user + route carries 'isPublic' metadata → actorType 'anonymous'
 *    (dead branch until Phase 5's @Public() exists, wired now so Phase 5
 *    only has to add the decorator, not touch this file).
 *  - no user + NOT public → a wiring bug (an @Audit'ed endpoint missing
 *    JwtAuthGuard). NEVER inferred to be 'system' — genuine system rows are
 *    written directly by whatever service runs outside an HTTP request, not
 *    by this interceptor. The action proceeds but the row is skipped and an
 *    error is logged loudly.
 *
 * Old/new capture: `metadata.fetchState` (supplied by the controller, which
 * knows its own route params/model — no magic model inference) is called
 * before the handler for the old state (all actions except 'create') and
 * again after it for the new state (all actions except 'delete'); without
 * it, oldValue is null and newValue falls back to the handler's response
 * body. Fetching the RAW Prisma entity is encouraged — AuditLogWriter
 * redacts every @Sensitive field before serialization (§8.3).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly auditLogWriter: AuditLogWriter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    // The before-state fetch must COMPLETE before the handler runs (an
    // update racing its own before-read would capture the new state as the
    // old one) — hence the from(...).pipe(mergeMap(=> next.handle())) chain:
    // next.handle() is only subscribed (i.e. the handler only starts) once
    // the old state has resolved.
    const oldStateFirst: Promise<object | null> =
      metadata.action !== 'create' ? this.safeFetchState(metadata, request, 'before') : Promise.resolve(null);

    return from(oldStateFirst).pipe(
      mergeMap((oldState) =>
        next.handle().pipe(
          mergeMap(async (responseBody: unknown) => {
            // Awaited inside the response pipeline so behavior is
            // deterministic (the row exists by the time the response lands),
            // but any failure is swallowed-and-logged by AuditLogWriter /
            // the catch below — the response itself is never corrupted.
            try {
              await this.writeRow(metadata, request, oldState, responseBody, context);
            } catch (error) {
              this.logger.error(
                `FAILED to assemble audit row for ${metadata.category}/${metadata.action} — action succeeded but is UNAUDITED.`,
                error instanceof Error ? error.stack : String(error),
              );
            }
            return responseBody;
          }),
        ),
      ),
    );
  }

  private async writeRow(
    metadata: AuditMetadata,
    request: Request & { user?: AuthenticatedUser },
    oldState: object | null,
    responseBody: unknown,
    context: ExecutionContext,
  ): Promise<void> {
    const actor = this.resolveActor(request, context, metadata);
    if (!actor) return; // wiring bug already logged — never guess 'system'.

    const newState =
      metadata.action === 'delete'
        ? null
        : metadata.fetchState
          ? await this.safeFetchState(metadata, request, 'after')
          : this.asLoggableBody(responseBody);

    const meta = extractRequestMeta(request);
    await this.auditLogWriter.write({
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      actorSessionId: actor.actorSessionId,
      category: metadata.category,
      entityType: metadata.entityType,
      entityId: this.resolveEntityId(metadata, request, responseBody),
      action: metadata.action,
      oldValue: oldState,
      newValue: newState,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  private resolveActor(
    request: Request & { user?: AuthenticatedUser },
    context: ExecutionContext,
    metadata: AuditMetadata,
  ): { actorType: 'user' | 'anonymous'; actorUserId: string | null; actorSessionId: string | null } | null {
    if (request.user) {
      return { actorType: 'user', actorUserId: request.user.userId, actorSessionId: request.user.sessionId };
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      // Phase 5's @Public() branch — traceable by ip/user_agent only (§7.5).
      return { actorType: 'anonymous', actorUserId: null, actorSessionId: null };
    }
    this.logger.error(
      `@Audit(${metadata.category}/${metadata.action}) endpoint ${request.method} ${request.url} ran with ` +
        'no request.user and no isPublic metadata — JwtAuthGuard is missing from an audited endpoint (wiring ' +
        "bug). Refusing to guess an actor_type ('system' is never inferred from an HTTP request); NO audit row written.",
    );
    return null;
  }

  private async safeFetchState(
    metadata: AuditMetadata,
    request: Request,
    phase: 'before' | 'after',
  ): Promise<object | null> {
    if (!metadata.fetchState) return null;
    try {
      return await metadata.fetchState(this.prisma, request);
    } catch (error) {
      this.logger.error(
        `@Audit fetchState (${phase}) failed for ${metadata.category}/${metadata.action} — the ` +
          `${phase === 'before' ? 'old' : 'new'} value will be recorded as null.`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  private resolveEntityId(metadata: AuditMetadata, request: Request, responseBody: unknown): string | null {
    const param = request.params?.[metadata.entityIdParam ?? 'id'];
    if (typeof param === 'string' && param.length > 0) return param;
    if (responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)) {
      const id = (responseBody as Record<string, unknown>).id;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  /** Only object-shaped response bodies are loggable as a JSONB new_value. */
  private asLoggableBody(responseBody: unknown): object | null {
    return responseBody !== null && typeof responseBody === 'object' ? (responseBody as object) : null;
  }
}
