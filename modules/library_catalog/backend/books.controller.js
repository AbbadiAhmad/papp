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
exports.BooksController = void 0;
const common_1 = require("@nestjs/common");
const books_service_1 = require("./books.service");
const create_book_copy_dto_1 = require("./dto/create-book-copy.dto");
const create_book_dto_1 = require("./dto/create-book.dto");
const list_books_dto_1 = require("./dto/list-books.dto");
const rate_book_dto_1 = require("./dto/rate-book.dto");
const update_book_copy_dto_1 = require("./dto/update-book-copy.dto");
const update_book_dto_1 = require("./dto/update-book.dto");
const platform_1 = require("./platform");
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fetchBookState = (prisma, req) => prisma.libraryCatalogBook.findUnique({ where: { id: req.params.id } });
const fetchCopyState = (prisma, req) => prisma.libraryCatalogBookCopy.findUnique({ where: { id: req.params.id } });
/**
 * `JwtAuthGuard`/`PermissionGuard`/`AuditInterceptor` are GLOBAL platform
 * guards (app.module.ts's `APP_GUARD`/`APP_INTERCEPTOR` providers) — they
 * already apply to every controller in the merged root module, including
 * this dynamically-loaded one (module-loader.ts imports this module's
 * NestJS module class straight into the same DI graph `AppModule` lives in,
 * see main.ts's `buildRootModule`). Only `MustChangePasswordGuard` needs to
 * be applied here explicitly, matching every core controller's own pattern
 * (see ./platform.ts's docblock for why it's a local instance, not an
 * import of core's).
 *
 * Route registration order matters within one controller: `export`, the
 * `ratings/*` moderation routes, and the nested `:bookId/copies...` routes
 * are all declared BEFORE `:id` so Express never mistakes a literal
 * single-segment path (or a copies sub-path) for a book id (the same lesson
 * apps/api/src/core/users/users.module.ts's docblock explains).
 */
let BooksController = class BooksController {
    books;
    constructor(books) {
        this.books = books;
    }
    async list(query) {
        return this.books.list(query);
    }
    async export(res) {
        const buffer = await this.books.exportBooksWorkbook();
        res.set({
            'Content-Type': XLSX_CONTENT_TYPE,
            'Content-Disposition': 'attachment; filename="library-catalog-books-export.xlsx"',
        });
        res.send(buffer);
    }
    // --- Review moderation (LIBRARY_CATALOG-D21) -----------------------------
    // "The librarian has to approve the comments to publish it" — a separate
    // cross-book queue, not a privileged view of GET /books/:id's own ratings
    // list (see BooksService.listPendingReviews's own docblock for why).
    async listPendingReviews() {
        return this.books.listPendingReviews();
    }
    async approveReview(ratingId, user) {
        return this.books.approveReview(ratingId, user.userId);
    }
    async rejectReview(ratingId, user) {
        return this.books.rejectReview(ratingId, user.userId);
    }
    async findById(id, user) {
        return this.books.findById(id, user.userId);
    }
    async create(dto) {
        return this.books.create(dto);
    }
    async update(id, dto) {
        return this.books.update(id, dto);
    }
    async remove(id) {
        await this.books.remove(id);
    }
    // --- Copies --------------------------------------------------------------
    // Gated by the SAME books.* permissions (docs/MODULE_SPEC.md's own worked
    // example declares no separate copies.* codes — copies are a sub-entity of
    // Books, not an independently-permissioned domain, per
    // docs/LIBRARY_MODULE_REQUIREMENTS.md §5).
    async listCopies(bookId) {
        return this.books.listCopies(bookId);
    }
    async getCopyHistory(bookId, copyId, limit) {
        const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 10;
        return this.books.getCopyHistory(copyId, limitNumber);
    }
    async createCopy(bookId, dto) {
        return this.books.createCopy(bookId, dto);
    }
    async updateCopy(bookId, id, dto) {
        return this.books.updateCopy(bookId, id, dto);
    }
    async removeCopy(bookId, id) {
        await this.books.removeCopy(bookId, id);
    }
    // --- Ratings (LIBRARY_CATALOG-D20) ---------------------------------------
    // Self-scoped: always the CALLER's own rating (@CurrentUser()), never a
    // rate-on-someone-else's-behalf endpoint — `books.rate` is grantable to
    // any role, not hardcoded to "reader" (see manifest.json/DECISIONS.md).
    // The full ratings list + aggregate + the caller's own rating are already
    // returned by `GET /books/:id` (`findById` above) — no separate list route.
    async rateBook(bookId, dto, user) {
        return this.books.rateBook(bookId, user.userId, dto);
    }
    async removeRating(bookId, user) {
        await this.books.removeRating(bookId, user.userId);
    }
};
exports.BooksController = BooksController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('library_catalog.books.view'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_books_dto_1.ListBooksDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('export'),
    (0, platform_1.RequirePermission)('library_catalog.books.export'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "export", null);
__decorate([
    (0, common_1.Get)('ratings/pending'),
    (0, platform_1.RequirePermission)('library_catalog.books.moderate_ratings'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "listPendingReviews", null);
__decorate([
    (0, common_1.Post)('ratings/:ratingId/approve'),
    (0, platform_1.RequirePermission)('library_catalog.books.moderate_ratings'),
    (0, platform_1.Audit)({ category: 'library_catalog.ratings', entityType: 'LibraryCatalogBookRating', action: 'approve_review' }),
    __param(0, (0, common_1.Param)('ratingId', new common_1.ParseUUIDPipe())),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "approveReview", null);
__decorate([
    (0, common_1.Post)('ratings/:ratingId/reject'),
    (0, platform_1.RequirePermission)('library_catalog.books.moderate_ratings'),
    (0, platform_1.Audit)({ category: 'library_catalog.ratings', entityType: 'LibraryCatalogBookRating', action: 'reject_review' }),
    __param(0, (0, common_1.Param)('ratingId', new common_1.ParseUUIDPipe())),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "rejectReview", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.RequirePermission)('library_catalog.books.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "findById", null);
__decorate([
    (0, common_1.Post)(),
    (0, platform_1.RequirePermission)('library_catalog.books.create'),
    (0, platform_1.Audit)({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_book_dto_1.CreateBookDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, platform_1.RequirePermission)('library_catalog.books.update'),
    (0, platform_1.Audit)({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'update', fetchState: fetchBookState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_book_dto_1.UpdateBookDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('library_catalog.books.delete'),
    (0, platform_1.Audit)({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'delete', fetchState: fetchBookState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)(':bookId/copies'),
    (0, platform_1.RequirePermission)('library_catalog.books.view'),
    __param(0, (0, common_1.Param)('bookId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "listCopies", null);
__decorate([
    (0, common_1.Get)(':bookId/copies/:copyId/catalog-history'),
    (0, platform_1.RequirePermission)('library_catalog.books.view'),
    __param(0, (0, common_1.Param)('bookId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('copyId', new common_1.ParseUUIDPipe())),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "getCopyHistory", null);
__decorate([
    (0, common_1.Post)(':bookId/copies'),
    (0, platform_1.RequirePermission)('library_catalog.books.create'),
    (0, platform_1.Audit)({ category: 'library_catalog.copies', entityType: 'LibraryCatalogBookCopy', action: 'create' }),
    __param(0, (0, common_1.Param)('bookId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_book_copy_dto_1.CreateBookCopyDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "createCopy", null);
__decorate([
    (0, common_1.Patch)(':bookId/copies/:id'),
    (0, platform_1.RequirePermission)('library_catalog.books.update'),
    (0, platform_1.Audit)({
        category: 'library_catalog.copies',
        entityType: 'LibraryCatalogBookCopy',
        action: 'update',
        fetchState: fetchCopyState,
    }),
    __param(0, (0, common_1.Param)('bookId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, update_book_copy_dto_1.UpdateBookCopyDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "updateCopy", null);
__decorate([
    (0, common_1.Delete)(':bookId/copies/:id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('library_catalog.books.delete'),
    (0, platform_1.Audit)({
        category: 'library_catalog.copies',
        entityType: 'LibraryCatalogBookCopy',
        action: 'delete',
        fetchState: fetchCopyState,
    }),
    __param(0, (0, common_1.Param)('bookId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "removeCopy", null);
__decorate([
    (0, common_1.Put)(':bookId/rating'),
    (0, platform_1.RequirePermission)('library_catalog.books.rate'),
    (0, platform_1.Audit)({ category: 'library_catalog.ratings', entityType: 'LibraryCatalogBookRating', action: 'upsert' }),
    __param(0, (0, common_1.Param)('bookId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, rate_book_dto_1.RateBookDto, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "rateBook", null);
__decorate([
    (0, common_1.Delete)(':bookId/rating'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('library_catalog.books.rate'),
    (0, platform_1.Audit)({ category: 'library_catalog.ratings', entityType: 'LibraryCatalogBookRating', action: 'delete' }),
    __param(0, (0, common_1.Param)('bookId', new common_1.ParseUUIDPipe())),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "removeRating", null);
exports.BooksController = BooksController = __decorate([
    (0, common_1.Controller)('api/library/books'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [books_service_1.BooksService])
], BooksController);
