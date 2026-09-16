import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { SettingsService } from '../../core/settings/settings.service';
import { PUBLIC_ENDPOINT_RATE_LIMIT_KEY, PublicEndpointRateLimit } from '../../core/settings/settings.types';

/**
 * Per-IP throttle for `@Public()` WRITE endpoints (MODULE_SPEC.md §7.3, D34).
 * Applied via `@UseGuards(PublicThrottlerGuard)` on each public write
 * endpoint — never optional for one (the §6 "never" list), starting with
 * `POST /auth/register` (D41).
 *
 * The limit is read from `security.public_endpoint_rate_limit`
 * ({limit, windowSeconds}, seeded by 0007) via SettingsService ON EVERY
 * REQUEST — not baked into a forRoot() at bootstrap — so an admin tuning it
 * takes effect immediately (BUILD_PLAN.md risk #7). SettingsService caches
 * in-memory and invalidates on write, so the per-request read is one Map hit.
 *
 * Sliding-window counter, in-memory, keyed by client IP: sufficient for the
 * single-`api`-process docker-compose topology (D5) — same scale-out caveat
 * as SettingsService's cache; if the api is ever scaled out this needs a
 * shared store. Memory is bounded by pruning each key's window lazily and
 * sweeping empty keys periodically.
 *
 * Client IP: `request.ip` — which is the socket peer address unless Express
 * `trust proxy` is enabled. main.ts enables it ONLY when the TRUST_PROXY env
 * var says the api sits behind a reverse proxy (the docker-compose `web`
 * nginx), in which case Express derives the client IP from X-Forwarded-For
 * to the configured depth. NEVER trust X-Forwarded-For unconditionally: a
 * direct caller could spoof the header and dodge the per-IP limit entirely.
 */
@Injectable()
export class PublicThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(PublicThrottlerGuard.name);

  /** ip -> request timestamps (ms) within the current window, oldest first. */
  private readonly hits = new Map<string, number[]>();
  private lastSweepAt = Date.now();
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  constructor(private readonly settings: SettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { limit, windowSeconds } = await this.settings.get<PublicEndpointRateLimit>(
      PUBLIC_ENDPOINT_RATE_LIMIT_KEY,
    );

    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    const windowStart = now - windowSeconds * 1_000;

    this.sweepIfDue(windowStart);

    const timestamps = (this.hits.get(ip) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= limit) {
      this.logger.warn(
        `Rate limit exceeded for ${ip} on ${request.method} ${request.url} ` +
          `(${timestamps.length} requests in the last ${windowSeconds}s, limit ${limit}).`,
      );
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    timestamps.push(now);
    this.hits.set(ip, timestamps);
    return true;
  }

  /** Drops IPs whose whole window has expired, so the map can't grow forever. */
  private sweepIfDue(windowStart: number): void {
    const now = Date.now();
    if (now - this.lastSweepAt < PublicThrottlerGuard.SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    for (const [ip, timestamps] of this.hits) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= windowStart) {
        this.hits.delete(ip);
      }
    }
  }
}
