import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { getJwtSecret } from '../../core/auth/jwt.constants';
import { PrismaService } from '../../prisma/prisma.service';

const LAST_ACTIVE_THROTTLE_MS = 60_000;

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

/**
 * Validates the access token AND cross-checks that the session it names
 * (`sid`) is still live in `user_sessions` — a bare JWT signature/expiry
 * check alone would let a revoked session's access token keep working
 * until it naturally expires, which docs/TESTING_STRATEGY.md §4 explicitly
 * requires NOT to happen ("a revoked session's access token is rejected on
 * the very next request, no stale-token grace window"). Permissions are
 * deliberately not resolved here — that's Phase 2's PermissionGuard.
 *
 * Recognizes an `isPublic` reflector key so `@Public()` (added in Phase 5,
 * `common/decorators/public.decorator.ts`) can exempt routes without any
 * change to this file — exactly the one-line change anticipated back in
 * Phase 1's version of this docblock.
 *
 * Phase 5: registered as a global `APP_GUARD` provider in app.module.ts
 * (before `PermissionGuard`, which reads `request.user` this guard
 * populates). This now DOES gate every route in the app, including
 * `AuthController`'s `login`/`refresh`/`register` — which is exactly why
 * those three are marked `@Public()` (so this guard short-circuits to "no
 * user" for them instead of demanding a Bearer token nobody has yet).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, { secret: getJwtSecret() });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session is no longer active');
    }
    if (session.userId !== payload.sub) {
      throw new UnauthorizedException('Token/session mismatch');
    }
    if (!session.user.isActive) {
      throw new UnauthorizedException('User is no longer active');
    }

    const now = new Date();
    if (now.getTime() - session.lastActiveAt.getTime() >= LAST_ACTIVE_THROTTLE_MS) {
      // Throttled per ARCHITECTURE.md §6.1 point 3 ("not literally every
      // request, to avoid write amplification"). Not awaited-critical for
      // request correctness, but awaited here anyway to keep behavior
      // deterministic for tests exercising idle-timeout logic.
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { lastActiveAt: now },
      });
    }

    (request as Request & { user?: unknown }).user = {
      userId: session.userId,
      sessionId: session.id,
      email: session.user.email,
      mustChangePassword: session.user.mustChangePassword,
    };

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return undefined;
    return token;
  }
}
