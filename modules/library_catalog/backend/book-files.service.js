"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var BookFilesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookFilesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const fs_1 = require("fs");
const path_1 = require("path");
const book_file_rules_1 = require("./book-file-rules");
/**
 * Stores each book's cover picture and book file on disk (LIBRARY_CATALOG-D28):
 *
 *   <BOOK_FILES_DIR>/<book id>/cover.<ext>
 *   <BOOK_FILES_DIR>/<book id>/book.<ext>
 *   <BOOK_FILES_DIR>/<book id>/info.txt      (title, author, id — so a folder can be identified by hand)
 *
 * The folder is the book's own UUID (from the database, never from the request), the file names are
 * fixed, and the uploaded file name is not stored anywhere. `library_catalog_book_files` records what is
 * on disk (kind, type, size) and is what the app trusts. Own `PrismaClient`, as in BooksService.
 */
let BookFilesService = BookFilesService_1 = class BookFilesService {
    logger = new common_1.Logger(BookFilesService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    /** Read on every call so a deployment (and a test) can point it elsewhere. */
    rootDir() {
        return process.env.BOOK_FILES_DIR || (0, path_1.join)(process.cwd(), 'data', 'books_files');
    }
    folder(bookId) {
        return (0, path_1.join)(this.rootDir(), bookId);
    }
    pathOf(bookId, kind, ext) {
        return (0, path_1.join)(this.folder(bookId), `${kind}.${ext}`);
    }
    async upload(bookId, kind, bytes, userId) {
        const book = await this.prisma.libraryCatalogBook.findUnique({ where: { id: bookId } });
        if (!book)
            throw new common_1.NotFoundException('Book not found');
        const checked = (0, book_file_rules_1.validateUpload)(kind, bytes);
        if ('error' in checked)
            throw new common_1.BadRequestException(checked.error);
        const { ext, mime } = checked.file;
        await fs_1.promises.mkdir(this.folder(bookId), { recursive: true });
        const target = this.pathOf(bookId, kind, ext);
        const temp = `${target}.${process.pid}.tmp`;
        await fs_1.promises.writeFile(temp, bytes);
        await fs_1.promises.rename(temp, target);
        const previous = await this.prisma.libraryCatalogBookFile.findUnique({ where: { bookId_kind: { bookId, kind } } });
        await this.prisma.libraryCatalogBookFile.upsert({
            where: { bookId_kind: { bookId, kind } },
            create: { bookId, kind, ext, mime, sizeBytes: bytes.length, uploadedBy: userId },
            update: { ext, mime, sizeBytes: bytes.length, uploadedBy: userId },
        });
        if (previous && previous.ext !== ext)
            await fs_1.promises.rm(this.pathOf(bookId, kind, previous.ext), { force: true });
        await this.writeInfo(bookId);
        return this.summary(bookId);
    }
    async remove(bookId, kind) {
        const row = await this.prisma.libraryCatalogBookFile.findUnique({ where: { bookId_kind: { bookId, kind } } });
        if (!row)
            throw new common_1.NotFoundException('There is no such file for this book');
        await this.prisma.libraryCatalogBookFile.delete({ where: { id: row.id } });
        await fs_1.promises.rm(this.pathOf(bookId, kind, row.ext), { force: true });
        const left = await this.prisma.libraryCatalogBookFile.count({ where: { bookId } });
        if (left === 0)
            await fs_1.promises.rm(this.folder(bookId), { recursive: true, force: true });
    }
    /** Called after a book is deleted: its rows are gone by cascade, so remove the folder. */
    async removeAll(bookId) {
        await fs_1.promises.rm(this.folder(bookId), { recursive: true, force: true });
    }
    async summary(bookId) {
        return (await this.summaries([bookId])).get(bookId) ?? { cover: null, book: null, images: [] };
    }
    async summaries(bookIds) {
        const map = new Map();
        if (bookIds.length === 0)
            return map;
        const rows = await this.prisma.libraryCatalogBookFile.findMany({ where: { bookId: { in: bookIds } } });
        for (const row of rows) {
            const entry = map.get(row.bookId) ?? { cover: null, book: null, images: [] };
            entry[row.kind] = { ext: row.ext, sizeBytes: row.sizeBytes, updatedAt: row.updatedAt };
            map.set(row.bookId, entry);
        }
        const images = await this.prisma.libraryCatalogBookImage.findMany({ where: { bookId: { in: bookIds } }, orderBy: { createdAt: 'asc' } });
        for (const image of images) {
            const entry = map.get(image.bookId) ?? { cover: null, book: null, images: [] };
            entry.images.push({ id: image.id, ext: image.ext, sizeBytes: image.sizeBytes });
            map.set(image.bookId, entry);
        }
        return map;
    }
    imagePath(bookId, imageId, ext) {
        return (0, path_1.join)(this.folder(bookId), 'images', `${imageId}.${ext}`);
    }
    /** Adds one gallery picture (same type/size rules as the cover); at most MAX_IMAGES_PER_BOOK per book. */
    async addImage(bookId, bytes, userId) {
        const book = await this.prisma.libraryCatalogBook.findUnique({ where: { id: bookId } });
        if (!book)
            throw new common_1.NotFoundException('Book not found');
        const checked = (0, book_file_rules_1.validateUpload)('cover', bytes);
        if ('error' in checked)
            throw new common_1.BadRequestException(checked.error);
        if ((await this.prisma.libraryCatalogBookImage.count({ where: { bookId } })) >= book_file_rules_1.MAX_IMAGES_PER_BOOK) {
            throw new common_1.BadRequestException(`A book can have at most ${book_file_rules_1.MAX_IMAGES_PER_BOOK} extra pictures`);
        }
        const { ext, mime } = checked.file;
        const row = await this.prisma.libraryCatalogBookImage.create({ data: { bookId, ext, mime, sizeBytes: bytes.length, uploadedBy: userId } });
        try {
            await fs_1.promises.mkdir((0, path_1.join)(this.folder(bookId), 'images'), { recursive: true });
            await fs_1.promises.writeFile(this.imagePath(bookId, row.id, ext), bytes);
        }
        catch (err) {
            await this.prisma.libraryCatalogBookImage.delete({ where: { id: row.id } });
            throw err;
        }
        await this.writeInfo(bookId);
        return this.summary(bookId);
    }
    async removeImage(bookId, imageId) {
        const row = await this.prisma.libraryCatalogBookImage.findUnique({ where: { id: imageId } });
        if (!row || row.bookId !== bookId)
            throw new common_1.NotFoundException('There is no such picture for this book');
        await this.prisma.libraryCatalogBookImage.delete({ where: { id: imageId } });
        await fs_1.promises.rm(this.imagePath(bookId, imageId, row.ext), { force: true });
    }
    async locateImage(bookId, imageId) {
        const row = await this.prisma.libraryCatalogBookImage.findUnique({ where: { id: imageId } });
        if (!row || row.bookId !== bookId)
            return null;
        return { path: this.imagePath(bookId, imageId, row.ext), mime: row.mime };
    }
    /** Where a file is, from the DB row only. `downloadAs` is built from the book title, never from the upload. */
    async locate(bookId, kind) {
        const row = await this.prisma.libraryCatalogBookFile.findUnique({ where: { bookId_kind: { bookId, kind } }, include: { book: true } });
        if (!row)
            return null;
        return { path: this.pathOf(bookId, kind, row.ext), mime: row.mime, downloadAs: (0, book_file_rules_1.downloadName)(row.book.title, row.ext) };
    }
    /**
     * (Re)writes `info.txt` so someone browsing the disk can tell which book a folder belongs to even if
     * the database link is lost. Best effort: failure is logged, never fails the request.
     */
    async writeInfo(bookId) {
        try {
            const book = await this.prisma.libraryCatalogBook.findUnique({ where: { id: bookId } });
            if (!book)
                return;
            const exists = await fs_1.promises.stat(this.folder(bookId)).then((s) => s.isDirectory(), () => false);
            if (!exists)
                return;
            const lines = [
                `Book ID: ${book.id}`,
                `Title: ${book.title}`,
                `Author: ${book.author ?? ''}`,
                `Publisher: ${book.publisher ?? ''}`,
                `Updated: ${new Date().toISOString()}`,
            ];
            await fs_1.promises.writeFile((0, path_1.join)(this.folder(bookId), 'info.txt'), `${lines.join('\n')}\n`, 'utf8');
        }
        catch (err) {
            this.logger.warn(`could not write info.txt for ${bookId}: ${err.message}`);
        }
    }
};
exports.BookFilesService = BookFilesService;
exports.BookFilesService = BookFilesService = BookFilesService_1 = __decorate([
    (0, common_1.Injectable)()
], BookFilesService);
