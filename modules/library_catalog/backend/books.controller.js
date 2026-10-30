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
const platform_express_1 = require("@nestjs/platform-express");
const book_files_service_1 = require("./book-files.service");
const books_import_service_1 = require("./books-import.service");
const books_service_1 = require("./books.service");
const create_book_copy_dto_1 = require("./dto/create-book-copy.dto");
const create_book_dto_1 = require("./dto/create-book.dto");
const list_books_dto_1 = require("./dto/list-books.dto");
const list_copies_for_inventory_dto_1 = require("./dto/list-copies-for-inventory.dto");
const list_copies_for_print_dto_1 = require("./dto/list-copies-for-print.dto");
const rate_book_dto_1 = require("./dto/rate-book.dto");
const update_book_copy_dto_1 = require("./dto/update-book-copy.dto");
const update_book_dto_1 = require("./dto/update-book.dto");
const permission_checker_1 = require("./permission-checker");
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
 * `ratings/*` moderation routes, the `copies/stickers*` print-codes routes,
 * and the nested `:bookId/copies...` routes are all declared BEFORE `:id` so
 * Express never mistakes a literal single-segment path (or a copies
 * sub-path) for a book id (the same lesson
 * apps/api/src/core/users/users.module.ts's docblock explains).
 */
let BooksController = class BooksController {
    books;
    files;
    importer;
    permissions;
    constructor(books, files, importer, permissions) {
        this.books = books;
        this.files = files;
        this.importer = importer;
        this.permissions = permissions;
    }
    /** Staff-only internal notes (LIBRARY_CATALOG-D35): only for callers who also hold `notes.view`. */
    async canSeeNotes(user) {
        return (await this.permissions.getEffectivePermissionCodes(user.userId)).has(permission_checker_1.NOTES_VIEW_PERMISSION);
    }
    /** Writing a note needs `notes.view` too (so nobody overwrites a note they cannot read); the route's own books.create/update still applies. */
    async assertMayWriteNote(user, ...notes) {
        if (notes.some((n) => n !== undefined) && !(await this.canSeeNotes(user))) {
            throw new common_1.ForbiddenException('Changing internal notes needs the "library_catalog.notes.view" permission');
        }
    }
    async list(query, user) {
        const books = await this.books.list(query, await this.canSeeNotes(user));
        const summaries = await this.files.summaries(books.map((b) => b.id));
        return books.map((b) => ({ ...b, files: summaries.get(b.id) ?? { cover: null, book: null, images: [] } }));
    }
    async export(res, user) {
        const buffer = await this.books.exportBooksWorkbook({}, await this.canSeeNotes(user));
        res.set({
            'Content-Type': XLSX_CONTENT_TYPE,
            'Content-Disposition': 'attachment; filename="library-catalog-books-export.xlsx"',
        });
        res.send(buffer);
    }
    // --- Excel import of the exported file (LIBRARY_CATALOG-D31). Declared before any ':id' route. ---
    /** Validates only — writes nothing. */
    async importPreview(user, file) {
        if (!file)
            throw new common_1.BadRequestException('No file uploaded (expected multipart field "file")');
        return this.importer.preview(file.buffer, await this.canSeeNotes(user));
    }
    async importCommit(user, file, decisionsJson) {
        if (!file)
            throw new common_1.BadRequestException('No file uploaded (expected multipart field "file")');
        let decisions;
        try {
            decisions = JSON.parse(decisionsJson ?? '');
        }
        catch {
            throw new common_1.BadRequestException('"decisions" must be a JSON object (expected multipart field "decisions")');
        }
        if (!decisions || typeof decisions !== 'object' || typeof decisions.books !== 'object')
            throw new common_1.BadRequestException('"decisions.books" is required');
        return this.importer.commit(file.buffer, decisions, await this.canSeeNotes(user));
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
        const book = await this.books.findById(id, user.userId, await this.canSeeNotes(user));
        return { ...book, files: await this.files.summary(id) };
    }
    async create(dto, user) {
        await this.assertMayWriteNote(user, dto.internalNote, dto.copy?.internalNote);
        return this.books.create(dto);
    }
    async update(id, dto, user) {
        await this.assertMayWriteNote(user, dto.internalNote);
        const updated = await this.books.update(id, dto);
        await this.files.writeInfo(id); // keeps info.txt (title/author) in step with the record
        return updated;
    }
    async remove(id) {
        await this.books.remove(id);
        await this.files.removeAll(id); // the folder (cover, book file, info.txt); the rows went with the book
    }
    // --- Print Codes / stickers (LIBRARY_CATALOG-D22) ------------------------
    // Read-only, cross-book — filtered by acquisitionDate range, feeding the
    // frontend's printable sticker sheet (real QR images, client-side) and
    // this Excel export (QR as text). Gated by a dedicated permission, not
    // `books.view`/`books.export` — printing physical stickers is a distinct,
    // separately-grantable action from viewing or exporting the catalog list.
    async listCopiesForPrint(query) {
        return this.books.listCopiesForPrint(query);
    }
    async exportCopiesForPrint(query, res) {
        const buffer = await this.books.exportCopiesForPrintWorkbook(query);
        res.set({
            'Content-Type': XLSX_CONTENT_TYPE,
            'Content-Disposition': 'attachment; filename="library-catalog-copy-stickers-export.xlsx"',
        });
        res.send(buffer);
    }
    // --- Inventory (user request: "help the librarian on the Annual
    // inventory") --------------------------------------------------------------
    // Read-only, cross-book — filtered by status/location/book title, not
    // acquisitionDate (that's the sticker workflow's own filter above). Gated
    // by a dedicated permission, not `books.view`/`copies.print_codes` —
    // walking the shelves for inventory is a distinct, separately-grantable
    // action from viewing the catalog or printing stickers. Registered before
    // `:bookId/copies` for the same Express route-ordering reason as every
    // other `copies/*` literal route above.
    async listCopiesForInventory(query) {
        return this.books.listCopiesForInventory(query);
    }
    async exportCopiesForInventory(query, res, user) {
        const buffer = await this.books.exportCopiesForInventoryWorkbook(query, await this.canSeeNotes(user));
        res.set({
            'Content-Type': XLSX_CONTENT_TYPE,
            'Content-Disposition': 'attachment; filename="library-catalog-inventory-export.xlsx"',
        });
        res.send(buffer);
    }
    // --- Copies --------------------------------------------------------------
    // Gated by the SAME books.* permissions (docs/MODULE_SPEC.md's own worked
    // example declares no separate copies.* codes — copies are a sub-entity of
    // Books, not an independently-permissioned domain, per
    // docs/LIBRARY_MODULE_REQUIREMENTS.md §5).
    // Registered before `:bookId/copies` for the same Express route-ordering
    // reason as `export`/`ratings/*`/`copies/stickers*` above — `next-code`
    // would otherwise be swallowed by `:bookId`. Gated by `books.create` (the
    // same permission that actually creates a copy) rather than a new code —
    // this is pure create-flow UX (LIBRARY_CATALOG-D22 follow-up: "suggest the
    // next code" in the Add Book / Add Copy forms), not a separately
    // grantable action.
    async peekNextCopyCode() {
        return { qrCode: await this.books.peekNextCopyCode() };
    }
    async listCopies(bookId, user) {
        return this.books.listCopies(bookId, await this.canSeeNotes(user));
    }
    async getCopyHistory(bookId, copyId, limit) {
        const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 10;
        return this.books.getCopyHistory(copyId, limitNumber);
    }
    async createCopy(bookId, dto, user) {
        await this.assertMayWriteNote(user, dto.internalNote);
        return this.books.createCopy(bookId, dto);
    }
    async updateCopy(bookId, id, dto, user) {
        await this.assertMayWriteNote(user, dto.internalNote);
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
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_books_dto_1.ListBooksDto, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('export'),
    (0, platform_1.RequirePermission)('library_catalog.books.export'),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "export", null);
__decorate([
    (0, common_1.Post)('import/preview'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, platform_1.RequirePermission)('library_catalog.books.import'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    __param(0, (0, platform_1.CurrentUser)()),
    __param(1, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "importPreview", null);
__decorate([
    (0, common_1.Post)('import'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, platform_1.RequirePermission)('library_catalog.books.import'),
    (0, platform_1.Audit)({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'import' }),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    __param(0, (0, platform_1.CurrentUser)()),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)('decisions')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "importCommit", null);
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
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_book_dto_1.CreateBookDto, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, platform_1.RequirePermission)('library_catalog.books.update'),
    (0, platform_1.Audit)({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'update', fetchState: fetchBookState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_book_dto_1.UpdateBookDto, Object]),
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
    (0, common_1.Get)('copies/stickers'),
    (0, platform_1.RequirePermission)('library_catalog.copies.print_codes'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_copies_for_print_dto_1.ListCopiesForPrintDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "listCopiesForPrint", null);
__decorate([
    (0, common_1.Get)('copies/stickers/export'),
    (0, platform_1.RequirePermission)('library_catalog.copies.print_codes'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_copies_for_print_dto_1.ListCopiesForPrintDto, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "exportCopiesForPrint", null);
__decorate([
    (0, common_1.Get)('copies/inventory'),
    (0, platform_1.RequirePermission)('library_catalog.copies.inventory'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_copies_for_inventory_dto_1.ListCopiesForInventoryDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "listCopiesForInventory", null);
__decorate([
    (0, common_1.Get)('copies/inventory/export'),
    (0, platform_1.RequirePermission)('library_catalog.copies.inventory'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_copies_for_inventory_dto_1.ListCopiesForInventoryDto, Object, Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "exportCopiesForInventory", null);
__decorate([
    (0, common_1.Get)('copies/next-code'),
    (0, platform_1.RequirePermission)('library_catalog.books.create'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "peekNextCopyCode", null);
__decorate([
    (0, common_1.Get)(':bookId/copies'),
    (0, platform_1.RequirePermission)('library_catalog.books.view'),
    __param(0, (0, common_1.Param)('bookId', new common_1.ParseUUIDPipe())),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
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
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_book_copy_dto_1.CreateBookCopyDto, Object]),
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
    __param(3, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, update_book_copy_dto_1.UpdateBookCopyDto, Object]),
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
    __param(3, (0, common_1.Inject)(permission_checker_1.PERMISSION_CHECKER)),
    __metadata("design:paramtypes", [books_service_1.BooksService,
        book_files_service_1.BookFilesService,
        books_import_service_1.BooksImportService, Object])
], BooksController);
