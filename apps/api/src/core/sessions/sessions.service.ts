import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicSession, toPublicSession } from './session.presenter';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<PublicSession[]> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId },
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
}
