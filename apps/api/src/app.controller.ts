import { Controller, Get, HttpCode } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  /**
   * Liveness/readiness check. Only registered (and only ever returns 200)
   * once Nest has finished building the module graph — which, per
   * apps/api/src/main.ts, happens after core migrations have already run and
   * the `core` module_registry row has been seeded. A caller getting a 200
   * here can rely on core's schema being in place.
   *
   * `@Public()`: docker-compose's own healthcheck (docker-compose.yml) calls
   * this with no Authorization header — Phase 5's global `JwtAuthGuard`
   * (app.module.ts) would otherwise 401 it, breaking container healthchecks.
   */
  @Get('health')
  @HttpCode(200)
  @Public()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
