"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRequestMeta = extractRequestMeta;
/**
 * Local re-implementation of core's own
 * `apps/api/src/core/auth/request-meta.util.ts` (two lines — not worth
 * reaching into `apps/api/dist/...` for, unlike `PublicThrottlerGuard`/
 * `NotificationsModule`, which carry real behavior this module must not
 * duplicate or drift from).
 */
function extractRequestMeta(req) {
    return {
        ipAddress: req.ip ?? req.socket?.remoteAddress ?? undefined,
        userAgent: req.headers['user-agent'] ?? undefined,
    };
}
