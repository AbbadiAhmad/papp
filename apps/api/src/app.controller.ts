import { Controller, Get, HttpCode } from '@nestjs/common';

@Controller()
export class AppController {
  /**
   * Liveness/readiness check. Only registered (and only ever returns 200)
   * once Nest has finished building the module graph — which, per
   * apps/api/src/main.ts, happens after core migrations have already run and
   * the `core` module_registry row has been seeded. A caller getting a 200
   * here can rely on core's schema being in place.
   */
  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
