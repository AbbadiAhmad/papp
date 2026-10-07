import { UserSession } from '@prisma/client';

/** Public shape of a session row — never includes `refreshTokenHash`. */
export interface PublicSession {
  id: string;
  userId: string;
  userName: string | null;
  issuedAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  geoLocation: unknown;
  revokedAt: Date | null;
}

export function toPublicSession(session: UserSession & { user?: { name: string } | null }): PublicSession {
  return {
    id: session.id,
    userId: session.userId,
    userName: session.user?.name ?? null,
    issuedAt: session.issuedAt,
    lastActiveAt: session.lastActiveAt,
    expiresAt: session.expiresAt,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    geoLocation: session.geoLocation,
    revokedAt: session.revokedAt,
  };
}
