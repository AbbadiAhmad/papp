"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicBooksController = void 0;
const common_1 = require("@nestjs/common");
// The REAL core guard, imported from apps/api's BUILT output (never `src/`)
// — see this file's docblock below and platform.ts's docblock for exactly
// why. This is the one deliberate cross-repo runtime dependency in this
// whole module: apps/api must be built at least once before this module's
// backend is loaded, which is already true in every real deployment
// (Dockerfile builds apps/api first; `nest build`/`nest start` always
// compile to dist before the resulting process could dynamically import
// this module at all).
// eslint-disable-next-line import/no-unresolved
const public_throttler_guard_1 = require("../../../apps/api/dist/common/guards/public-throttler.guard");
const book_files_service_1 = require("./book-files.service");
const books_service_1 = require("./books.service");
const platform_1 = require("./platform");
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
let PublicBooksController = class PublicBooksController {
    books;
    files;
    constructor(books, files) {
        this.books = books;
        this.files = files;
    }
    async availability(id) {
        // getAvailability() already throws a plain NotFoundException for a
        // missing book — exactly what an anonymous caller should see (404, no
        // stack trace or internal detail), MODULE_SPEC.md §7.2.
        return this.books.getAvailability(id);
    }
    /**
     * The book's cover picture, for <img> tags (which cannot send an Authorization header). Only the cover
     * is public — the book FILE is never served here. Not audited: it is hit once per cover per page view.
     */
    async cover(id, res) {
        const found = await this.files.locate(id, 'cover');
        if (!found)
            throw new common_1.NotFoundException('This book has no cover');
        res.set({
            'Content-Type': found.mime,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'cross-origin',
            // The cover can be replaced, so the browser must revalidate (sendFile adds an ETag).
            'Cache-Control': 'public, max-age=0, must-revalidate',
        });
        res.sendFile(found.path, (err) => {
            if (err && !res.headersSent)
                res.status(404).json({ statusCode: 404, message: 'Cover not found' });
        });
    }
    /** An extra gallery picture of a book; public for the same reason as the cover (<img> cannot send credentials). */
    async image(id, imageId, res) {
        const found = await this.files.locateImage(id, imageId);
        if (!found)
            throw new common_1.NotFoundException('This picture does not exist');
        res.set({
            'Content-Type': found.mime,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'Cache-Control': 'public, max-age=86400',
        });
        res.sendFile(found.path, (err) => {
            if (err && !res.headersSent)
                res.status(404).json({ statusCode: 404, message: 'Picture not found' });
        });
    }
};
exports.PublicBooksController = PublicBooksController;
__decorate([
    (0, common_1.Get)(':id/availability'),
    (0, platform_1.Public)(),
    (0, common_1.UseGuards)(public_throttler_guard_1.PublicThrottlerGuard),
    (0, platform_1.Audit)({
        category: 'library_catalog.public',
        entityType: 'LibraryCatalogBook',
        action: 'view_availability',
    }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicBooksController.prototype, "availability", null);
__decorate([
    (0, common_1.Get)(':id/cover'),
    (0, platform_1.Public)(),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PublicBooksController.prototype, "cover", null);
__decorate([
    (0, common_1.Get)(':id/images/:imageId'),
    (0, platform_1.Public)(),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('imageId', new common_1.ParseUUIDPipe())),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], PublicBooksController.prototype, "image", null);
exports.PublicBooksController = PublicBooksController = __decorate([
    (0, common_1.Controller)('api/library/public/books'),
    __metadata("design:paramtypes", [books_service_1.BooksService,
        book_files_service_1.BookFilesService])
], PublicBooksController);
