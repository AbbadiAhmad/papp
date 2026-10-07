import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LibraryCatalogBookCopyStatus, Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { CreateBookCopyDto } from './dto/create-book-copy.dto';
import { CreateBookDto } from './dto/create-book.dto';
import { ListBooksDto } from './dto/list-books.dto';
import { ListCopiesForInventoryDto } from './dto/list-copies-for-inventory.dto';
import { ListCopiesForPrintDto } from './dto/list-copies-for-print.dto';
import { RateBookDto } from './dto/rate-book.dto';
import { UpdateBookCopyDto } from './dto/update-book-copy.dto';
import { UpdateBookDto } from './dto/update-book.dto';

/** `Bxxxxxx` — zero-padded to 6 digits (LIBRARY_CATALOG-D22). */
const COPY_CODE_PREFIX = 'B';
const COPY_CODE_DIGITS = 6;

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
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { copies: { some: { qrCode: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }
    if (query.category) {
      where.category = query.category;
    }
    const copyStatuses = (query.copyStatus ?? []) as LibraryCatalogBookCopyStatus[];
    if (copyStatuses.length > 0) {
      where.copies = { some: { status: { in: copyStatuses } } };
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
      const availableCopies = book.copies.filter((c) => c.status === LibraryCatalogBookCopyStatus.available).length;
      const ratingAgg = ratingsByBook.get(book.id);
      return {
        ...book,
        totalCopies,
        availableCopies,
        // Per-status tally, so the list can show "1 damaged · 2 lost" without opening the book.
        copyStatusCounts: book.copies.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {}),
        // Only when filtering by status: the copies that matched, so each can be opened by its code.
        matchingCopies:
          copyStatuses.length > 0
            ? book.copies
                .filter((c) => copyStatuses.includes(c.status))
                .sort((a, b) => a.qrCode.localeCompare(b.qrCode))
                .map((c) => ({ id: c.id, qrCode: c.qrCode, status: c.status }))
            : undefined,
        averageRating: ratingAgg?._avg.rating ?? null,
        ratingsCount: ratingAgg?._count.rating ?? 0,
        copies: undefined,
        _count: undefined,
      };
    });
  }

  async findById(id: string, currentUserId?: string) {
    const book = await this.prisma.libraryCatalogBook.findUnique({
      where: { id },
      include: { copies: { orderBy: { createdAt: 'asc' } } },
    });
    if (!book) {
      throw new NotFoundException(`Book "${id}" not found`);
    }

    // ALL ratings count toward the average/count — moderation only gates the
    // WRITTEN review text, never the numeric star score (LIBRARY_CATALOG-D21).
    const ratings = await this.prisma.libraryCatalogBookRating.findMany({ where: { bookId: id }, orderBy: { updatedAt: 'desc' } });
    const raterIds = [...new Set(ratings.map((r) => r.userId))];
    const raters = raterIds.length ? await this.prisma.user.findMany({ where: { id: { in: raterIds } }, select: { id: true, name: true } }) : [];
    const raterNameById = new Map(raters.map((r) => [r.id, r.name]));
    const myRatingRow = currentUserId ? ratings.find((r) => r.userId === currentUserId) : undefined;

    // A review only appears in the PUBLIC list once approved — with one
    // exception: the caller always sees their OWN review regardless of its
    // moderation status, so they know what they submitted and its state.
    // A moderator reviews/acts on pending items through the dedicated
    // `listPendingReviews`/`approveReview`/`rejectReview` queue below, not
    // by getting a privileged view of this same list.
    const visibleRatings = ratings.filter((r) => r.reviewStatus === 'approved' || r.userId === currentUserId);

    return {
      ...book,
      averageRating: ratings.length ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : null,
      ratingsCount: ratings.length,
      ratings: visibleRatings.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: raterNameById.get(r.userId) ?? null,
        rating: r.rating,
        review: r.review,
        reviewStatus: r.reviewStatus,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      myRating: myRatingRow ? { rating: myRatingRow.rating, review: myRatingRow.review, reviewStatus: myRatingRow.reviewStatus } : null,
    };
  }

  async create(dto: CreateBookDto) {
    const { copy, ...bookData } = dto;
    return this.prisma.$transaction(async (tx) => {
      const book = await tx.libraryCatalogBook.create({ data: bookData });
      // Every copy created — whether auto-assigned or typed in by hand —
      // advances `library_catalog_copy_code_seq` (see `nextCopyCode()` and
      // `reconcileCopyCodeSequence()` below for why a manually-typed code
      // still needs to bump the sequence).
      const manualCode = copy.qrCode?.trim();
      const qrCode = manualCode || (await this.nextCopyCode(tx));
      if (manualCode) {
        await this.reconcileCopyCodeSequence(tx, manualCode);
      }
      await tx.libraryCatalogBookCopy.create({
        data: {
          bookId: book.id,
          qrCode,
          status: copy.status ?? 'available',
          condition: copy.condition,
          location: copy.location,
          acquisitionDate: copy.acquisitionDate ? new Date(copy.acquisitionDate) : null,
        },
      });
      return book;
    });
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
    const requestedCode = dto.qrCode?.trim();
    if (requestedCode) {
      const existing = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { qrCode: requestedCode } });
      if (existing) {
        throw new ConflictException(`A copy with QR code "${requestedCode}" already exists`);
      }
    }
    const qrCode = requestedCode || (await this.nextCopyCode(this.prisma));
    // See the matching comment in `create()` above — a manually-typed code
    // (e.g. the librarian overrides the suggested one) still needs to bump
    // the sequence so the NEXT suggestion is reevaluated and doesn't collide.
    if (requestedCode) {
      await this.reconcileCopyCodeSequence(this.prisma, requestedCode);
    }
    return this.prisma.libraryCatalogBookCopy.create({
      data: {
        bookId,
        qrCode,
        status: dto.status ?? LibraryCatalogBookCopyStatus.available,
        condition: dto.condition,
        location: dto.location,
        acquisitionDate: dto.acquisitionDate ? new Date(dto.acquisitionDate) : undefined,
      },
    });
  }

  async updateCopy(bookId: string, copyId: string, dto: UpdateBookCopyDto) {
    const copy = await this.findCopyOrThrow(bookId, copyId);

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (dto.status !== undefined && dto.status !== copy.status) {
      changes.status = { before: copy.status, after: dto.status };
    }
    if (dto.condition !== undefined && dto.condition !== copy.condition) {
      changes.condition = { before: copy.condition, after: dto.condition };
    }
    if (dto.location !== undefined && dto.location !== copy.location) {
      changes.location = { before: copy.location, after: dto.location };
    }

    let historyEntry: Record<string, unknown> | null = null;
    if (Object.keys(changes).length > 0) {
      historyEntry = {
        timestamp: new Date().toISOString(),
        changes,
      };
    }

    const history = (copy.history as Record<string, unknown>[]) || [];
    const updatedHistory = historyEntry ? [...history, historyEntry].slice(-100) : history;

    return this.prisma.libraryCatalogBookCopy.update({
      where: { id: copy.id },
      data: { ...dto, history: updatedHistory as unknown as Prisma.InputJsonValue },
    });
  }

  async removeCopy(bookId: string, copyId: string): Promise<void> {
    await this.findCopyOrThrow(bookId, copyId);
    try {
      await this.prisma.libraryCatalogBookCopy.delete({ where: { id: copyId } });
    } catch (err) {
      // library_borrowings.book_copy_id has no ON DELETE CASCADE (history is
      // never deleted, per library_circulation's own migration comment) — a
      // copy with borrowing history hits Postgres FK violation P2003.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException(`Copy "${copyId}" has borrowing history and cannot be removed`);
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

  /**
   * "The librarian has to approve the comments to publish it"
   * (LIBRARY_CATALOG-D21): a review with no text needs no moderation at all
   * (`reviewStatus` stays/starts 'approved'). Submitting or editing NON-EMPTY
   * review text always resets `reviewStatus` to 'pending' and clears any
   * prior moderation decision — a previously-approved comment that gets
   * edited must be re-approved, never grandfathered in silently. Editing
   * only the star rating (leaving the review text unchanged) never disturbs
   * an already-approved/-rejected review's status.
   */
  async rateBook(bookId: string, userId: string, dto: RateBookDto) {
    await this.ensureBookExists(bookId);
    const existing = await this.prisma.libraryCatalogBookRating.findUnique({ where: { bookId_userId: { bookId, userId } } });
    const newReview = dto.review ?? null;
    const reviewChanged = (existing?.review ?? null) !== newReview;
    const reviewStatus = !newReview ? 'approved' : reviewChanged ? 'pending' : existing!.reviewStatus;

    return this.prisma.libraryCatalogBookRating.upsert({
      where: { bookId_userId: { bookId, userId } },
      create: { bookId, userId, rating: dto.rating, review: newReview, reviewStatus },
      update: {
        rating: dto.rating,
        review: newReview,
        reviewStatus,
        ...(reviewChanged ? { moderatedBy: null, moderatedAt: null } : {}),
      },
    });
  }

  async removeRating(bookId: string, userId: string): Promise<void> {
    const existing = await this.prisma.libraryCatalogBookRating.findUnique({ where: { bookId_userId: { bookId, userId } } });
    if (!existing) {
      throw new NotFoundException('You have not rated this book');
    }
    await this.prisma.libraryCatalogBookRating.delete({ where: { id: existing.id } });
  }

  // --- Review moderation (LIBRARY_CATALOG-D21) -----------------------------
  // A separate, dedicated queue rather than a privileged view of `findById`'s
  // own ratings list (see that method's own docblock) — matches this
  // platform's existing "moderation/admin queue as its own screen" pattern
  // (e.g. the Users Excel-import preview, the Audit purge screen).

  /** Every review awaiting a decision, across every book — oldest first (first submitted, first reviewed). */
  async listPendingReviews() {
    const pending = await this.prisma.libraryCatalogBookRating.findMany({
      where: { reviewStatus: 'pending' },
      orderBy: { updatedAt: 'asc' },
    });
    if (pending.length === 0) return [];

    const bookIds = [...new Set(pending.map((r) => r.bookId))];
    const userIds = [...new Set(pending.map((r) => r.userId))];
    const [books, raters] = await Promise.all([
      this.prisma.libraryCatalogBook.findMany({ where: { id: { in: bookIds } }, select: { id: true, title: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    ]);
    const bookTitleById = new Map(books.map((b) => [b.id, b.title]));
    const raterNameById = new Map(raters.map((r) => [r.id, r.name]));

    return pending.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      bookTitle: bookTitleById.get(r.bookId) ?? null,
      userId: r.userId,
      userName: raterNameById.get(r.userId) ?? null,
      rating: r.rating,
      review: r.review,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async approveReview(ratingId: string, moderatorId: string) {
    return this.moderateReview(ratingId, 'approved', moderatorId);
  }

  async rejectReview(ratingId: string, moderatorId: string) {
    return this.moderateReview(ratingId, 'rejected', moderatorId);
  }

  private async moderateReview(ratingId: string, reviewStatus: 'approved' | 'rejected', moderatorId: string) {
    const existing = await this.prisma.libraryCatalogBookRating.findUnique({ where: { id: ratingId } });
    if (!existing) {
      throw new NotFoundException(`Rating "${ratingId}" not found`);
    }
    return this.prisma.libraryCatalogBookRating.update({
      where: { id: ratingId },
      data: { reviewStatus, moderatedBy: moderatorId, moderatedAt: new Date() },
    });
  }

  // --- History (Feature 2.1) --------------------------------------------------

  async getCopyHistory(copyId: string, limit: number = 10) {
    const copy = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { id: copyId } });
    if (!copy) {
      throw new NotFoundException(`Copy "${copyId}" not found`);
    }
    const history = (copy.history as Record<string, unknown>[]) || [];
    return history.slice(-limit);
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
      { header: 'page_count', key: 'pageCount', width: 12 },
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
        pageCount: book.pageCount ?? '',
        totalCopies: book._count.copies,
      });
    }
    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  // --- Print Codes / stickers (LIBRARY_CATALOG-D22) ------------------------
  // "filter the books entered last period ... export the book names,
  // copy-number and the QR for the copies" — a filter-by-acquisition-date
  // preview feeding either a printable sticker sheet (frontend-only, real
  // QR images rendered client-side like QrCodeImage.tsx) or this Excel
  // export (QR as text, same ExcelJS-cell limitation already accepted by
  // `exportBooksWorkbook` above).

  /** Copies whose `acquisitionDate` falls within [from, to] (inclusive, both optional), with their book's title joined in for display/validation only — never printed on the sticker itself. */
  async listCopiesForPrint(filter: ListCopiesForPrintDto) {
    const where: Prisma.LibraryCatalogBookCopyWhereInput = {};
    if (filter.from || filter.to) {
      where.acquisitionDate = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lte: new Date(filter.to) } : {}),
      };
    }
    const copies = await this.prisma.libraryCatalogBookCopy.findMany({
      where,
      orderBy: { acquisitionDate: 'asc' },
      include: { book: { select: { title: true } } },
    });
    return copies.map((copy) => ({
      id: copy.id,
      qrCode: copy.qrCode,
      location: copy.location,
      acquisitionDate: copy.acquisitionDate,
      bookTitle: copy.book.title,
    }));
  }

  async exportCopiesForPrintWorkbook(filter: ListCopiesForPrintDto): Promise<Buffer> {
    const copies = await this.listCopiesForPrint(filter);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Copies');
    worksheet.columns = [
      { header: 'book_title', key: 'bookTitle', width: 32 },
      { header: 'copy_code', key: 'qrCode', width: 16 },
      { header: 'location', key: 'location', width: 20 },
      { header: 'acquisition_date', key: 'acquisitionDate', width: 16 },
    ];
    for (const copy of copies) {
      worksheet.addRow({
        bookTitle: copy.bookTitle,
        qrCode: copy.qrCode,
        location: copy.location ?? '',
        acquisitionDate: copy.acquisitionDate ? copy.acquisitionDate.toISOString().slice(0, 10) : '',
      });
    }
    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  /**
   * Copies inventory page (user request: "a page to show the available
   * copies, (book name, copy code, location, status) ... to help the
   * librarian on the Annual inventory"). Filters by `status`/`location`/
   * book title — the dimensions an inventory walkthrough actually needs
   * (what's SUPPOSED to be where, and what state it's recorded in),
   * distinct from `listCopiesForPrint`'s own acquisition-date filter built
   * for the sticker/export workflow. Same `include: { book: {...} } }`
   * pattern as that method — both tables are in this module's own schema,
   * so a real Prisma `include` works here (unlike the cross-module
   * two-pass joins `library_circulation`'s own services use for tables
   * outside their own module).
   */
  async listCopiesForInventory(filter: ListCopiesForInventoryDto) {
    const where: Prisma.LibraryCatalogBookCopyWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.location) where.location = { contains: filter.location, mode: 'insensitive' };
    if (filter.bookSearch) where.book = { title: { contains: filter.bookSearch, mode: 'insensitive' } };

    const copies = await this.prisma.libraryCatalogBookCopy.findMany({
      where,
      orderBy: [{ book: { title: 'asc' } }, { qrCode: 'asc' }],
      include: { book: { select: { title: true } } },
    });
    return copies.map((copy) => ({
      id: copy.id,
      qrCode: copy.qrCode,
      bookTitle: copy.book.title,
      location: copy.location,
      status: copy.status,
      condition: copy.condition,
    }));
  }

  async exportCopiesForInventoryWorkbook(filter: ListCopiesForInventoryDto): Promise<Buffer> {
    const copies = await this.listCopiesForInventory(filter);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventory');
    worksheet.columns = [
      { header: 'book_title', key: 'bookTitle', width: 32 },
      { header: 'copy_code', key: 'qrCode', width: 16 },
      { header: 'location', key: 'location', width: 20 },
      { header: 'status', key: 'status', width: 14 },
      { header: 'condition', key: 'condition', width: 20 },
    ];
    for (const copy of copies) {
      worksheet.addRow({
        bookTitle: copy.bookTitle,
        qrCode: copy.qrCode,
        location: copy.location ?? '',
        status: copy.status,
        condition: copy.condition ?? '',
      });
    }
    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  // --- Helpers -----------------------------------------------------------

  /**
   * `Bxxxxxx` — zero-padded to 6 digits, backed by the real Postgres
   * sequence `library_catalog_copy_code_seq` (migration 006,
   * LIBRARY_CATALOG-D22) — only consulted when the librarian leaves
   * `qrCode` blank, same "sequence-backed reference number" pattern as
   * library_circulation's own `fine_number`/`transaction_number`
   * (`FinesService.nextNumber()`, root D75). `sequenceName` is always the
   * same hardcoded literal below, never user input, so `$queryRawUnsafe` is
   * safe here (identical justification to `FinesService.nextNumber()`).
   */
  private async nextCopyCode(client: Pick<PrismaClient, '$queryRawUnsafe'>): Promise<string> {
    const rows = await client.$queryRawUnsafe<Array<{ nextval: bigint }>>(
      "SELECT nextval('library_catalog_copy_code_seq') AS nextval",
    );
    return this.formatCopyCode(rows[0].nextval);
  }

  /**
   * Read-only preview of the code `nextCopyCode()` WOULD assign next,
   * without consuming the sequence (LIBRARY_CATALOG-D22 follow-up —
   * "suggest the next code" in the Add Book / Add Copy forms). Deliberately
   * does NOT call `nextval()` — that would burn a real sequence value even
   * if the librarian cancels the form, which is harmless for correctness
   * (a gap in the sequence is fine) but wasteful/confusing to show a
   * "suggested" code that then gets skipped. `SELECT * FROM <sequence>`
   * reads `last_value`/`is_called` with zero side effects: the next real
   * value is `last_value + 1` once the sequence has been consumed at least
   * once (`is_called = true`), or `last_value` itself if it never has
   * (`is_called = false`, i.e. this sequence's very first use).
   */
  async peekNextCopyCode(): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ last_value: bigint; is_called: boolean }>>(
      'SELECT last_value, is_called FROM library_catalog_copy_code_seq',
    );
    const { last_value, is_called } = rows[0];
    const next = is_called ? last_value + BigInt(1) : last_value;
    return this.formatCopyCode(next);
  }

  private formatCopyCode(value: bigint): string {
    return `${COPY_CODE_PREFIX}${value.toString().padStart(COPY_CODE_DIGITS, '0')}`;
  }

  /**
   * Bug fix (user-reported, post-D22): the suggested next code shown by
   * `peekNextCopyCode()` is pre-filled into the Add Book / Add Copy forms as
   * an editable, already-populated text field rather than a blank one — so
   * when the librarian accepts it as-is, it reaches `create()`/`createCopy()`
   * as an explicit, non-blank `qrCode`, which took the "manually typed"
   * branch and never called `nextCopyCode()` / consumed the sequence. Net
   * effect: the suggestion never advanced on a normal add (bug 1), and typing
   * in a genuinely different/concurrent code left the sequence just as stale
   * (bug 2) — the next peek could re-suggest a value that was just taken.
   *
   * Fix: whenever a copy is created with an EXPLICIT code (accepted
   * suggestion or a real manual/concurrent entry) that happens to match this
   * module's own `Bxxxxxx` format, fast-forward the sequence with `setval()`
   * so it's never behind the highest `Bxxxxxx` number actually in use — the
   * next `peekNextCopyCode()` is always reevaluated off the up-to-date
   * high-water mark. A manually-typed code OUTSIDE the `Bxxxxxx` format
   * (free text, pre-D22 legacy codes) has no numeric value to reconcile and
   * is left alone, same as before.
   */
  private async reconcileCopyCodeSequence(client: Pick<PrismaClient, '$queryRawUnsafe'>, enteredCode: string): Promise<void> {
    const match = new RegExp(`^${COPY_CODE_PREFIX}(\\d{${COPY_CODE_DIGITS}})$`).exec(enteredCode);
    if (!match) return;
    const enteredValue = BigInt(match[1]);
    // `setval(seq, n, true)` makes `n` the sequence's `last_value` with
    // `is_called = true`, i.e. the NEXT `nextval()` returns `n + 1` — exactly
    // matching "a copy numbered `enteredValue` now exists, so don't suggest
    // it (or anything at/under it) again". `GREATEST` against the sequence's
    // own current value keeps this a no-op when the entered code is BEHIND
    // the high-water mark already (e.g. an older/reused low number), so it
    // can never move the sequence backwards.
    await client.$queryRawUnsafe(
      "SELECT setval('library_catalog_copy_code_seq', GREATEST($1::bigint, (SELECT last_value FROM library_catalog_copy_code_seq)), true)",
      enteredValue,
    );
  }

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
