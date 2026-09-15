import type { Request } from 'express';

/** Extracts real client IP/user-agent from the request — never stubbed. */
export function extractRequestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const ipAddress = req.ip ?? req.socket?.remoteAddress ?? null;
  const userAgent = req.headers['user-agent'] ?? null;
  return { ipAddress, userAgent: userAgent ?? null };
}
