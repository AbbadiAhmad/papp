import { Controller, Get, Param, UseGuards } from '@nestjs/common';
// The REAL core guard, imported from apps/api's BUILT output (never `src/`)
// — see this file's docblock below and platform.ts's docblock for exactly
// why. This is the one deliberate cross-repo runtime dependency in this
// whole module: apps/api must be built at least once before this module's
// backend is loaded, which is already true in every real deployment
// (Dockerfile builds apps/api first; `nest build`/`nest start` always
// compile to dist before the resulting process could dynamically import
// this module at all).
// eslint-disable-next-line import/no-unresolved
import { PublicThrottlerGuard } from '../../../apps/api/dist/common/guards/public-throttler.guard';
import { BooksService, BookAvailability } from './books.service';
import { Audit, Public } from './platform';

/**
 * The one deliberate public route this phase exists to prove
 * (docs/BUILD_PLAN.md Phase 8, docs/MODULE_SPEC.md §7, D34): reachable with
 * NO `Authorization` header at all. `@Public()` (this module's own metadata
 * shim — see platform.ts) is what makes the GLOBAL `JwtAuthGuard` short-
 * circuit to "no user" instead of rejecting, and what makes the global
 * `PermissionGuard` no-op (no `@RequirePermission` is declared here at all —
 * MODULE_SPEC.md §7.1: RBAC is meaningless for an anonymous visitor).
 *
 * `PublicThrottlerGuard` here is the REAL core class (imported from
 * apps/api's BUILT output, not a local reimplementation — see platform.ts's
 * docblock for exactly why) — reads the real, admin-tunable
 * `security.public_endpoint_rate_limit` setting on every request. Not
 * strictly required for a read per MODULE_SPEC.md §7.3, but applied anyway
 * "for consistency since it's cheap" per BUILD_PLAN.md Phase 8's own note.
 *
 * `@Audit(...)` on a `@Get` is unusual (core's own convention reserves it
 * for mutations or "view_sensitive" reads, FEATURE_TEMPLATE.md §1) — applied
 * here DELIBERATELY, as an explicit exception: this phase's whole stated
 * purpose is giving the platform's `actor_type='anonymous'` mechanism
 * (ARCHITECTURE.md §8.1/D34) its first genuine, non-fixture exercise, and an
 * anonymous availability check has no "before/after" mutation to omit an
 * audit row for — this IS the interesting event worth recording (who/what
 * IP checked which book, when). See this Developer agent's final report for
 * the real `audit_log` row this produces.
 */
@Controller('api/library/public/books')
export class PublicBooksController {
  constructor(private readonly books: BooksService) {}

  @Get(':id/availability')
  @Public()
  @UseGuards(PublicThrottlerGuard)
  @Audit({
    category: 'library_catalog.public',
    entityType: 'LibraryCatalogBook',
    action: 'view_availability',
  })
  async availability(@Param('id') id: string): Promise<BookAvailability> {
    // getAvailability() already throws a plain NotFoundException for a
    // missing book — exactly what an anonymous caller should see (404, no
    // stack trace or internal detail), MODULE_SPEC.md §7.2.
    return this.books.getAvailability(id);
  }
}
