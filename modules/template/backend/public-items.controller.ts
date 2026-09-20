import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
// The REAL core guard, imported from apps/api's BUILT output (never `src/`)
// — see platform.ts's docblock / modules/library_catalog/backend/public.controller.ts
// for exactly why (D57's exception category — genuine shared logic, not a
// metadata marker, is the one thing a module imports for real).
// eslint-disable-next-line import/no-unresolved
import { PublicThrottlerGuard } from '../../../apps/api/dist/common/guards/public-throttler.guard';
import { ItemsService } from './items.service';
import { Public } from './platform';

/**
 * The one deliberate PUBLIC route (docs/MODULE_SPEC.md §7): reachable with
 * NO `Authorization` header at all — mounted directly by App.tsx in every
 * auth-status branch, never behind a login redirect. `@Public()` makes the
 * global `JwtAuthGuard` short-circuit to "no user" and `PermissionGuard`
 * no-op (no `@RequirePermission` here — RBAC is meaningless for an
 * anonymous visitor, §7.1). `ItemsService.getPublicIfActive` is the actual
 * access rule ("only a currently-active item, and never its owner"), a
 * plain 404 for anything else — never a permission error a visitor with no
 * account could never resolve.
 *
 * `PublicThrottlerGuard` here is applied even on this READ for consistency
 * with `library_catalog`'s own public route (see its own docblock) — not
 * strictly required for a read (MODULE_SPEC.md §7.3 only makes it
 * mandatory for a public WRITE), but cheap insurance against scraping.
 */
@Controller('api/template/public/items')
export class PublicItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get(':id')
  @Public()
  @UseGuards(PublicThrottlerGuard)
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.items.getPublicIfActive(id);
  }
}
