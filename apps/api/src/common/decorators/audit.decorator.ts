import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaService } from '../../prisma/prisma.service';

export const AUDIT_KEY = 'auditMetadata';

/**
 * Metadata for the globally-applied `AuditInterceptor` (ARCHITECTURE.md
 * §8.2). Attach `@Audit({...})` to every mutating endpoint; the interceptor
 * does the rest (actor resolution, before/after capture, @Sensitive
 * redaction, the `audit_log` write).
 */
export interface AuditMetadata {
  /** Owning module key + area, e.g. 'core.users', 'library.books' (§8.1). */
  category: string;
  /** e.g. 'User', 'Role', 'UserSession'. */
  entityType: string;
  /** 'create' | 'update' | 'delete' | 'assign' | 'revoke' | 'import' | ... */
  action: string;
  /**
   * How the interceptor captures entity state without magic model lookup:
   * the controller (which knows its own route params and model) supplies an
   * explicit fetch callback. The interceptor calls it
   *   - BEFORE the handler (old state) for every action except 'create', and
   *   - AFTER the handler (new state) for every action except 'delete'.
   * Return null when the entity doesn't exist (e.g. before an assign, after
   * an unassign). When omitted: oldValue is null and newValue falls back to
   * the handler's own response body. Fetch the RAW Prisma entity — the
   * interceptor redacts @Sensitive fields before anything is serialized.
   */
  fetchState?: (prisma: PrismaService, request: Request) => Promise<object | null>;
  /**
   * Route param holding the entity id (default 'id'; e.g. 'roleId' for the
   * grants endpoint). Falls back to the response body's `id` when the param
   * is absent (create endpoints), then null.
   */
  entityIdParam?: string;
}

export const Audit = (metadata: AuditMetadata): MethodDecorator => SetMetadata(AUDIT_KEY, metadata);
