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
exports.BookFilesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const book_file_rules_1 = require("./book-file-rules");
const book_files_service_1 = require("./book-files.service");
const platform_1 = require("./platform");
function parseKind(kind) {
    if (!book_file_rules_1.BOOK_FILE_KINDS.includes(kind))
        throw new common_1.BadRequestException('The file kind must be "cover" or "book"');
    return kind;
}
/**
 * A book's cover picture and its book file (LIBRARY_CATALOG-D28). Upload and delete need
 * `books.update`; downloading the book file needs its own `books.download`. The cover is shown from a
 * public route (PublicBooksController) because an <img> tag cannot send an Authorization header.
 */
let BookFilesController = class BookFilesController {
    files;
    constructor(files) {
        this.files = files;
    }
    async upload(id, kind, file, user) {
        return this.files.upload(id, parseKind(kind), file?.buffer, user.userId);
    }
    async remove(id, kind) {
        await this.files.remove(id, parseKind(kind));
    }
    /** The book file, always as a download (never rendered inside the site), named after the book's title. */
    async download(id, res) {
        const found = await this.files.locate(id, 'book');
        if (!found)
            throw new common_1.NotFoundException('This book has no file');
        res.set({
            'Content-Type': found.mime,
            'Content-Disposition': `attachment; filename="${found.downloadAs.ascii}"; filename*=UTF-8''${encodeURIComponent(found.downloadAs.utf8)}`,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cache-Control': 'private, no-store',
        });
        res.sendFile(found.path, (err) => {
            if (err && !res.headersSent)
                res.status(404).json({ statusCode: 404, message: 'File not found' });
        });
    }
};
exports.BookFilesController = BookFilesController;
__decorate([
    (0, common_1.Post)(':kind'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, platform_1.RequirePermission)('library_catalog.books.update'),
    (0, platform_1.Audit)({ category: 'library_catalog.books', entityType: 'LibraryCatalogBookFile', action: 'upload_file' })
    // +1 so an oversize file reaches the service's own, clearer message instead of a generic 413 (covers have their own, lower, limit there).
    ,
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: book_file_rules_1.MAX_BOOK_FILE_BYTES + 1 } })),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('kind')),
    __param(2, (0, common_1.UploadedFile)()),
    __param(3, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], BookFilesController.prototype, "upload", null);
__decorate([
    (0, common_1.Delete)(':kind'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('library_catalog.books.update'),
    (0, platform_1.Audit)({ category: 'library_catalog.books', entityType: 'LibraryCatalogBookFile', action: 'delete_file' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], BookFilesController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('book'),
    (0, platform_1.RequirePermission)('library_catalog.books.download'),
    (0, platform_1.Audit)({ category: 'library_catalog.books', entityType: 'LibraryCatalogBookFile', action: 'download_file' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BookFilesController.prototype, "download", null);
exports.BookFilesController = BookFilesController = __decorate([
    (0, common_1.Controller)('api/library/books/:id/files'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [book_files_service_1.BookFilesService])
], BookFilesController);
