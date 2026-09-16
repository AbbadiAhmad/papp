import type { Request } from 'express';

/**
 * Local re-implementation of core's own
 * `apps/api/src/core/auth/request-meta.util.ts` (two lines — not worth
 * reaching into `apps/api/dist/...` for, unlike `PublicThrottlerGuard`/
 * `NotificationsModule`, which carry real behavior this module must not
 * duplicate or drift from).
 */
export function extractRequestMeta(req: Request): { ipAddress?: string; userAgent?: string } {
  return {
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? undefined,
    userAgent: req.headers['user-agent'] ?? undefined,
  };
}
