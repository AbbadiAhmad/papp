import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LibraryCatalogBookCopyStatus, Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { CreateBookCopyDto } from './dto/create-book-copy.dto';
import { CreateBookDto } from './dto/create-book.dto';
import { ListBooksDto } from './dto/list-books.dto';
import { UpdateBookCopyDto } from './dto/update-book-copy.dto';
import { UpdateBookDto } from './dto/update-book.dto';

export interface BookAvailability {
  bookId: string;
  title: string;
  totalCopies: number;
  availableCopies: number;
}

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
@Injectable()
export class BooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BooksService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('library_catalog Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async list(query: ListBooksDto) {
    const where: Prisma.LibraryCatalogBookWhereInput = {};
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }
    if (query.category) {
      where.category = query.category;
    }
    const books = await this.prisma.libraryCatalogBook.findMany({
      where,
      orderBy: { title: 'asc' },
      include: { _count: { select: { copies: true } } },
    });
    return books.map((book) => ({
      ...book,
      totalCopies: book._count.copies,
      _count: undefined,
    }));
  }

  async findById(id: string) {
    const book = await this.prisma.libraryCatalogBook.findUnique({
      where: { id },
      include: { copies: { orderBy: { createdAt: 'asc' } } },
    });
    if (!book) {
      throw new NotFoundException(`Book "${id}" not found`);
    }
    return book;
  }

  async create(dto: CreateBookDto) {
    return this.prisma.libraryCatalogBook.create({ data: dto });
  }

  async update(id: string, dto: UpdateBookDto) {
    await this.ensureBookExists(id);
    return this.prisma.libraryCatalogBook.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    const book = await this.prisma.libraryCatalogBook.findUnique({
      where: { id },
      include: { _count: { select: { copies: true } } },
    });
    if (!book) {
      throw new NotFoundException(`Book "${id}" not found`);
    }
    if (book._count.copies > 0) {
      throw new ConflictException(
        `Book "${id}" still has ${book._count.copies} registered copy/copies — remove them first ` +
          '(a future library_circulation module may additionally block this once borrowing history exists, D44).',
      );
    }
    await this.prisma.libraryCatalogBook.delete({ where: { id } });
  }

  // --- Copies --------------------------------------------------------------

  async listCopies(bookId: string) {
    await this.ensureBookExists(bookId);
    return this.prisma.libraryCatalogBookCopy.findMany({ where: { bookId }, orderBy: { createdAt: 'asc' } });
  }

  async createCopy(bookId: string, dto: CreateBookCopyDto) {
    await this.ensureBookExists(bookId);
    const existing = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { qrCode: dto.qrCode } });
    if (existing) {
      throw new ConflictException(`A copy with QR code "${dto.qrCode}" already exists`);
    }
    return this.prisma.libraryCatalogBookCopy.create({
      data: {
        bookId,
        qrCode: dto.qrCode,
        status: dto.status ?? LibraryCatalogBookCopyStatus.available,
        condition: dto.condition,
        location: dto.location,
        acquisitionDate: dto.acquisitionDate ? new Date(dto.acquisitionDate) : undefined,
      },
    });
  }

  async updateCopy(bookId: string, copyId: string, dto: UpdateBookCopyDto) {
    const copy = await this.findCopyOrThrow(bookId, copyId);
    return this.prisma.libraryCatalogBookCopy.update({
      where: { id: copy.id },
      data: dto,
    });
  }

  // --- Public availability (MODULE_SPEC.md §7 / BUILD_PLAN.md Phase 8) -----

  async getAvailability(bookId: string): Promise<BookAvailability> {
    const book = await this.prisma.libraryCatalogBook.findUnique({
      where: { id: bookId },
      include: { copies: true },
    });
    if (!book) {
      // 404, not 403 — an anonymous visitor gets exactly the same "not
      // found" a logged-in one would for a bad id (MODULE_SPEC.md §7.2).
      throw new NotFoundException(`Book "${bookId}" not found`);
    }
    const availableCopies = book.copies.filter((c) => c.status === LibraryCatalogBookCopyStatus.available).length;
    return {
      bookId: book.id,
      title: book.title,
      totalCopies: book.copies.length,
      availableCopies,
    };
  }

  // --- Export ----------------------------------------------------------------

  async exportBooksWorkbook(): Promise<Buffer> {
    const books = await this.prisma.libraryCatalogBook.findMany({
      orderBy: { title: 'asc' },
      include: { _count: { select: { copies: true } } },
    });

    const workbook = new ExcelJS.Workbook();
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
    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  // --- Helpers -----------------------------------------------------------

  private async ensureBookExists(id: string): Promise<void> {
    const exists = await this.prisma.libraryCatalogBook.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new NotFoundException(`Book "${id}" not found`);
    }
  }

  private async findCopyOrThrow(bookId: string, copyId: string) {
    const copy = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { id: copyId } });
    if (!copy || copy.bookId !== bookId) {
      throw new NotFoundException(`Copy "${copyId}" not found for book "${bookId}"`);
    }
    return copy;
  }
}
