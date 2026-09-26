"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var BooksService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BooksService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const exceljs_1 = __importDefault(require("exceljs"));
/**
 * A dedicated `PrismaClient` instance rather than importing core's
 * `PrismaService` (apps/api/src/prisma/prisma.service.ts): the latter lives
 * outside this package's own boundary (a repo-relative import that would
 * only resolve at runtime if apps/api's OWN build output existed at that
 * exact relative path — fragile across dev/ts-node/compiled-dist execution
 * modes, see this Developer agent's final report for the full write-up).
 * `@prisma/client` is a real, hoisted npm package resolvable identically in
 * every execution mode, and it is the SAME generated client (including this
 * module's own `LibraryCatalogBook`/`LibraryCatalogBookCopy` models, once
 * `prisma generate` has run from apps/api) — just a second connection pool.
 * This is also the cleaner module-boundary choice per MODULE_SPEC.md §6
 * ("never write directly to another module's tables... cross-module data
 * access goes through that module's own service") applied to infrastructure,
 * not just data: this module owns its own Prisma lifecycle end to end.
 */
let BooksService = BooksService_1 = class BooksService {
    logger = new common_1.Logger(BooksService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('library_catalog Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async list(query) {
        const where = {};
        if (query.search) {
            where.title = { contains: query.search, mode: 'insensitive' };
        }
        if (query.category) {
            where.category = query.category;
        }
        const books = await this.prisma.libraryCatalogBook.findMany({
            where,
            orderBy: { title: 'asc' },
            include: {
                _count: { select: { copies: true } },
                copies: true,
            },
        });
        const ratingAggregates = await this.prisma.libraryCatalogBookRating.groupBy({
            by: ['bookId'],
            where: { bookId: { in: books.map((book) => book.id) } },
            _avg: { rating: true },
            _count: { rating: true },
        });
        const ratingsByBook = new Map(ratingAggregates.map((agg) => [agg.bookId, agg]));
        return books.map((book) => {
            const totalCopies = book._count.copies;
            const availableCopies = book.copies.filter((c) => c.status === client_1.LibraryCatalogBookCopyStatus.available).length;
            const ratingAgg = ratingsByBook.get(book.id);
            return {
                ...book,
                totalCopies,
                availableCopies,
                averageRating: ratingAgg?._avg.rating ?? null,
                ratingsCount: ratingAgg?._count.rating ?? 0,
                copies: undefined,
                _count: undefined,
            };
        });
    }
    async findById(id, currentUserId) {
        const book = await this.prisma.libraryCatalogBook.findUnique({
            where: { id },
            include: { copies: { orderBy: { createdAt: 'asc' } } },
        });
        if (!book) {
            throw new common_1.NotFoundException(`Book "${id}" not found`);
        }
        const ratings = await this.prisma.libraryCatalogBookRating.findMany({ where: { bookId: id }, orderBy: { updatedAt: 'desc' } });
        const raterIds = [...new Set(ratings.map((r) => r.userId))];
        const raters = raterIds.length ? await this.prisma.user.findMany({ where: { id: { in: raterIds } }, select: { id: true, name: true } }) : [];
        const raterNameById = new Map(raters.map((r) => [r.id, r.name]));
        const myRatingRow = currentUserId ? ratings.find((r) => r.userId === currentUserId) : undefined;
        return {
            ...book,
            averageRating: ratings.length ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : null,
            ratingsCount: ratings.length,
            ratings: ratings.map((r) => ({
                id: r.id,
                userId: r.userId,
                userName: raterNameById.get(r.userId) ?? null,
                rating: r.rating,
                review: r.review,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
            })),
            myRating: myRatingRow ? { rating: myRatingRow.rating, review: myRatingRow.review } : null,
        };
    }
    async create(dto) {
        const { copy, ...bookData } = dto;
        return this.prisma.$transaction(async (tx) => {
            const book = await tx.libraryCatalogBook.create({ data: bookData });
            await tx.libraryCatalogBookCopy.create({
                data: {
                    bookId: book.id,
                    qrCode: copy.qrCode,
                    status: copy.status ?? 'available',
                    condition: copy.condition,
                    location: copy.location,
                    acquisitionDate: copy.acquisitionDate ? new Date(copy.acquisitionDate) : null,
                },
            });
            return book;
        });
    }
    async update(id, dto) {
        await this.ensureBookExists(id);
        return this.prisma.libraryCatalogBook.update({ where: { id }, data: dto });
    }
    async remove(id) {
        const book = await this.prisma.libraryCatalogBook.findUnique({
            where: { id },
            include: { _count: { select: { copies: true } } },
        });
        if (!book) {
            throw new common_1.NotFoundException(`Book "${id}" not found`);
        }
        if (book._count.copies > 0) {
            throw new common_1.ConflictException(`Book "${id}" still has ${book._count.copies} registered copy/copies — remove them first ` +
                '(a future library_circulation module may additionally block this once borrowing history exists, D44).');
        }
        await this.prisma.libraryCatalogBook.delete({ where: { id } });
    }
    // --- Copies --------------------------------------------------------------
    async listCopies(bookId) {
        await this.ensureBookExists(bookId);
        return this.prisma.libraryCatalogBookCopy.findMany({ where: { bookId }, orderBy: { createdAt: 'asc' } });
    }
    async createCopy(bookId, dto) {
        await this.ensureBookExists(bookId);
        const existing = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { qrCode: dto.qrCode } });
        if (existing) {
            throw new common_1.ConflictException(`A copy with QR code "${dto.qrCode}" already exists`);
        }
        return this.prisma.libraryCatalogBookCopy.create({
            data: {
                bookId,
                qrCode: dto.qrCode,
                status: dto.status ?? client_1.LibraryCatalogBookCopyStatus.available,
                condition: dto.condition,
                location: dto.location,
                acquisitionDate: dto.acquisitionDate ? new Date(dto.acquisitionDate) : undefined,
            },
        });
    }
    async updateCopy(bookId, copyId, dto) {
        const copy = await this.findCopyOrThrow(bookId, copyId);
        const changes = {};
        if (dto.status !== undefined && dto.status !== copy.status) {
            changes.status = { before: copy.status, after: dto.status };
        }
        if (dto.condition !== undefined && dto.condition !== copy.condition) {
            changes.condition = { before: copy.condition, after: dto.condition };
        }
        if (dto.location !== undefined && dto.location !== copy.location) {
            changes.location = { before: copy.location, after: dto.location };
        }
        let historyEntry = null;
        if (Object.keys(changes).length > 0) {
            historyEntry = {
                timestamp: new Date().toISOString(),
                changes,
            };
        }
        const history = copy.history || [];
        const updatedHistory = historyEntry ? [...history, historyEntry].slice(-100) : history;
        return this.prisma.libraryCatalogBookCopy.update({
            where: { id: copy.id },
            data: { ...dto, history: updatedHistory },
        });
    }
    async removeCopy(bookId, copyId) {
        await this.findCopyOrThrow(bookId, copyId);
        try {
            await this.prisma.libraryCatalogBookCopy.delete({ where: { id: copyId } });
        }
        catch (err) {
            // library_borrowings.book_copy_id has no ON DELETE CASCADE (history is
            // never deleted, per library_circulation's own migration comment) — a
            // copy with borrowing history hits Postgres FK violation P2003.
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
                throw new common_1.ConflictException(`Copy "${copyId}" has borrowing history and cannot be removed`);
            }
            throw err;
        }
    }
    // --- Ratings (LIBRARY_CATALOG-D20) ---------------------------------------
    // One row per (book, user), editable — "rate" always upserts the caller's
    // OWN rating (self-scoped, gated by `library_catalog.books.rate`, never a
    // rate-on-behalf-of-someone-else endpoint). Reading the list/aggregate
    // needs only `books.view`, same permission the rest of the book detail
    // page already requires.
    async rateBook(bookId, userId, dto) {
        await this.ensureBookExists(bookId);
        return this.prisma.libraryCatalogBookRating.upsert({
            where: { bookId_userId: { bookId, userId } },
            create: { bookId, userId, rating: dto.rating, review: dto.review },
            update: { rating: dto.rating, review: dto.review },
        });
    }
    async removeRating(bookId, userId) {
        const existing = await this.prisma.libraryCatalogBookRating.findUnique({ where: { bookId_userId: { bookId, userId } } });
        if (!existing) {
            throw new common_1.NotFoundException('You have not rated this book');
        }
        await this.prisma.libraryCatalogBookRating.delete({ where: { id: existing.id } });
    }
    // --- History (Feature 2.1) --------------------------------------------------
    async getCopyHistory(copyId, limit = 10) {
        const copy = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { id: copyId } });
        if (!copy) {
            throw new common_1.NotFoundException(`Copy "${copyId}" not found`);
        }
        const history = copy.history || [];
        return history.slice(-limit);
    }
    // --- Public availability (MODULE_SPEC.md §7 / BUILD_PLAN.md Phase 8) -----
    async getAvailability(bookId) {
        const book = await this.prisma.libraryCatalogBook.findUnique({
            where: { id: bookId },
            include: { copies: true },
        });
        if (!book) {
            // 404, not 403 — an anonymous visitor gets exactly the same "not
            // found" a logged-in one would for a bad id (MODULE_SPEC.md §7.2).
            throw new common_1.NotFoundException(`Book "${bookId}" not found`);
        }
        const availableCopies = book.copies.filter((c) => c.status === client_1.LibraryCatalogBookCopyStatus.available).length;
        return {
            bookId: book.id,
            title: book.title,
            totalCopies: book.copies.length,
            availableCopies,
        };
    }
    // --- Export ----------------------------------------------------------------
    async exportBooksWorkbook() {
        const books = await this.prisma.libraryCatalogBook.findMany({
            orderBy: { title: 'asc' },
            include: { _count: { select: { copies: true } } },
        });
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Books');
        worksheet.columns = [
            { header: 'title', key: 'title', width: 32 },
            { header: 'author', key: 'author', width: 24 },
            { header: 'publisher', key: 'publisher', width: 24 },
            { header: 'category', key: 'category', width: 18 },
            { header: 'reading_level', key: 'readingLevel', width: 14 },
            { header: 'language', key: 'language', width: 12 },
            { header: 'total_copies', key: 'totalCopies', width: 12 },
        ];
        for (const book of books) {
            worksheet.addRow({
                title: book.title,
                author: book.author ?? '',
                publisher: book.publisher ?? '',
                category: book.category ?? '',
                readingLevel: book.readingLevel ?? '',
                language: book.language ?? '',
                totalCopies: book._count.copies,
            });
        }
        return workbook.xlsx.writeBuffer();
    }
    // --- Helpers -----------------------------------------------------------
    async ensureBookExists(id) {
        const exists = await this.prisma.libraryCatalogBook.findUnique({ where: { id }, select: { id: true } });
        if (!exists) {
            throw new common_1.NotFoundException(`Book "${id}" not found`);
        }
    }
    async findCopyOrThrow(bookId, copyId) {
        const copy = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { id: copyId } });
        if (!copy || copy.bookId !== bookId) {
            throw new common_1.NotFoundException(`Copy "${copyId}" not found for book "${bookId}"`);
        }
        return copy;
    }
};
exports.BooksService = BooksService;
exports.BooksService = BooksService = BooksService_1 = __decorate([
    (0, common_1.Injectable)()
], BooksService);
