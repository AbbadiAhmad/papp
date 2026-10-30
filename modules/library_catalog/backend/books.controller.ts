import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { BookFilesService } from './book-files.service';
import { ImportDecisions } from './books-import-rules';
import { BooksImportService } from './books-import.service';
import { BooksService } from './books.service';
import { CreateBookCopyDto } from './dto/create-book-copy.dto';
import { CreateBookDto } from './dto/create-book.dto';
import { ListBooksDto } from './dto/list-books.dto';
import { ListCopiesForInventoryDto } from './dto/list-copies-for-inventory.dto';
import { ListCopiesForPrintDto } from './dto/list-copies-for-print.dto';
import { RateBookDto } from './dto/rate-book.dto';
import { UpdateBookCopyDto } from './dto/update-book-copy.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const fetchBookState = (prisma: PrismaClient, req: Request) =>
  prisma.libraryCatalogBook.findUnique({ where: { id: req.params.id as string } });

const fetchCopyState = (prisma: PrismaClient, req: Request) =>
  prisma.libraryCatalogBookCopy.findUnique({ where: { id: req.params.id as string } });

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
@Controller('api/library/books')
@UseGuards(MustChangePasswordGuard)
export class BooksController {
  constructor(
    private readonly books: BooksService,
    private readonly files: BookFilesService,
    private readonly importer: BooksImportService,
  ) {}

  @Get()
  @RequirePermission('library_catalog.books.view')
  async list(@Query() query: ListBooksDto) {
    const books = await this.books.list(query);
    const summaries = await this.files.summaries(books.map((b: { id: string }) => b.id));
    return books.map((b: { id: string }) => ({ ...b, files: summaries.get(b.id) ?? { cover: null, book: null, images: [] } }));
  }

  @Get('export')
  @RequirePermission('library_catalog.books.export')
  async export(@Res() res: Response): Promise<void> {
    const buffer = await this.books.exportBooksWorkbook();
    res.set({
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': 'attachment; filename="library-catalog-books-export.xlsx"',
    });
    res.send(buffer);
  }

  // --- Excel import of the exported file (LIBRARY_CATALOG-D31). Declared before any ':id' route. ---

  /** Validates only — writes nothing. */
  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('library_catalog.books.import')
  @UseInterceptors(FileInterceptor('file'))
  async importPreview(@UploadedFile() file?: { buffer: Buffer }) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file")');
    return this.importer.preview(file.buffer);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('library_catalog.books.import')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'import' })
  @UseInterceptors(FileInterceptor('file'))
  async importCommit(@UploadedFile() file: { buffer: Buffer } | undefined, @Body('decisions') decisionsJson?: string) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file")');
    let decisions: ImportDecisions;
    try {
      decisions = JSON.parse(decisionsJson ?? '') as ImportDecisions;
    } catch {
      throw new BadRequestException('"decisions" must be a JSON object (expected multipart field "decisions")');
    }
    if (!decisions || typeof decisions !== 'object' || typeof decisions.books !== 'object') throw new BadRequestException('"decisions.books" is required');
    return this.importer.commit(file.buffer, decisions);
  }

  // --- Review moderation (LIBRARY_CATALOG-D21) -----------------------------
  // "The librarian has to approve the comments to publish it" — a separate
  // cross-book queue, not a privileged view of GET /books/:id's own ratings
  // list (see BooksService.listPendingReviews's own docblock for why).

  @Get('ratings/pending')
  @RequirePermission('library_catalog.books.moderate_ratings')
  async listPendingReviews() {
    return this.books.listPendingReviews();
  }

  @Post('ratings/:ratingId/approve')
  @RequirePermission('library_catalog.books.moderate_ratings')
  @Audit({ category: 'library_catalog.ratings', entityType: 'LibraryCatalogBookRating', action: 'approve_review' })
  async approveReview(@Param('ratingId', new ParseUUIDPipe()) ratingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.books.approveReview(ratingId, user.userId);
  }

  @Post('ratings/:ratingId/reject')
  @RequirePermission('library_catalog.books.moderate_ratings')
  @Audit({ category: 'library_catalog.ratings', entityType: 'LibraryCatalogBookRating', action: 'reject_review' })
  async rejectReview(@Param('ratingId', new ParseUUIDPipe()) ratingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.books.rejectReview(ratingId, user.userId);
  }

  @Get(':id')
  @RequirePermission('library_catalog.books.view')
  async findById(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    const book = await this.books.findById(id, user.userId);
    return { ...book, files: await this.files.summary(id) };
  }

  @Post()
  @RequirePermission('library_catalog.books.create')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'create' })
  async create(@Body() dto: CreateBookDto) {
    return this.books.create(dto);
  }

  @Patch(':id')
  @RequirePermission('library_catalog.books.update')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'update', fetchState: fetchBookState })
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateBookDto) {
    const updated = await this.books.update(id, dto);
    await this.files.writeInfo(id); // keeps info.txt (title/author) in step with the record
    return updated;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_catalog.books.delete')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'delete', fetchState: fetchBookState })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.books.remove(id);
    await this.files.removeAll(id); // the folder (cover, book file, info.txt); the rows went with the book
  }

  // --- Print Codes / stickers (LIBRARY_CATALOG-D22) ------------------------
  // Read-only, cross-book — filtered by acquisitionDate range, feeding the
  // frontend's printable sticker sheet (real QR images, client-side) and
  // this Excel export (QR as text). Gated by a dedicated permission, not
  // `books.view`/`books.export` — printing physical stickers is a distinct,
  // separately-grantable action from viewing or exporting the catalog list.

  @Get('copies/stickers')
  @RequirePermission('library_catalog.copies.print_codes')
  async listCopiesForPrint(@Query() query: ListCopiesForPrintDto) {
    return this.books.listCopiesForPrint(query);
  }

  @Get('copies/stickers/export')
  @RequirePermission('library_catalog.copies.print_codes')
  async exportCopiesForPrint(@Query() query: ListCopiesForPrintDto, @Res() res: Response): Promise<void> {
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

  @Get('copies/inventory')
  @RequirePermission('library_catalog.copies.inventory')
  async listCopiesForInventory(@Query() query: ListCopiesForInventoryDto) {
    return this.books.listCopiesForInventory(query);
  }

  @Get('copies/inventory/export')
  @RequirePermission('library_catalog.copies.inventory')
  async exportCopiesForInventory(@Query() query: ListCopiesForInventoryDto, @Res() res: Response): Promise<void> {
    const buffer = await this.books.exportCopiesForInventoryWorkbook(query);
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
  @Get('copies/next-code')
  @RequirePermission('library_catalog.books.create')
  async peekNextCopyCode() {
    return { qrCode: await this.books.peekNextCopyCode() };
  }

  @Get(':bookId/copies')
  @RequirePermission('library_catalog.books.view')
  async listCopies(@Param('bookId', new ParseUUIDPipe()) bookId: string) {
    return this.books.listCopies(bookId);
  }

  @Get(':bookId/copies/:copyId/catalog-history')
  @RequirePermission('library_catalog.books.view')
  async getCopyHistory(@Param('bookId', new ParseUUIDPipe()) bookId: string, @Param('copyId', new ParseUUIDPipe()) copyId: string, @Query('limit') limit?: string) {
    const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 10;
    return this.books.getCopyHistory(copyId, limitNumber);
  }

  @Post(':bookId/copies')
  @RequirePermission('library_catalog.books.create')
  @Audit({ category: 'library_catalog.copies', entityType: 'LibraryCatalogBookCopy', action: 'create' })
  async createCopy(@Param('bookId', new ParseUUIDPipe()) bookId: string, @Body() dto: CreateBookCopyDto) {
    return this.books.createCopy(bookId, dto);
  }

  @Patch(':bookId/copies/:id')
  @RequirePermission('library_catalog.books.update')
  @Audit({
    category: 'library_catalog.copies',
    entityType: 'LibraryCatalogBookCopy',
    action: 'update',
    fetchState: fetchCopyState,
  })
  async updateCopy(@Param('bookId', new ParseUUIDPipe()) bookId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateBookCopyDto) {
    return this.books.updateCopy(bookId, id, dto);
  }

  @Delete(':bookId/copies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_catalog.books.delete')
  @Audit({
    category: 'library_catalog.copies',
    entityType: 'LibraryCatalogBookCopy',
    action: 'delete',
    fetchState: fetchCopyState,
  })
  async removeCopy(@Param('bookId', new ParseUUIDPipe()) bookId: string, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.books.removeCopy(bookId, id);
  }

  // --- Ratings (LIBRARY_CATALOG-D20) ---------------------------------------
  // Self-scoped: always the CALLER's own rating (@CurrentUser()), never a
  // rate-on-someone-else's-behalf endpoint — `books.rate` is grantable to
  // any role, not hardcoded to "reader" (see manifest.json/DECISIONS.md).
  // The full ratings list + aggregate + the caller's own rating are already
  // returned by `GET /books/:id` (`findById` above) — no separate list route.

  @Put(':bookId/rating')
  @RequirePermission('library_catalog.books.rate')
  @Audit({ category: 'library_catalog.ratings', entityType: 'LibraryCatalogBookRating', action: 'upsert' })
  async rateBook(@Param('bookId', new ParseUUIDPipe()) bookId: string, @Body() dto: RateBookDto, @CurrentUser() user: AuthenticatedUser) {
    return this.books.rateBook(bookId, user.userId, dto);
  }

  @Delete(':bookId/rating')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_catalog.books.rate')
  @Audit({ category: 'library_catalog.ratings', entityType: 'LibraryCatalogBookRating', action: 'delete' })
  async removeRating(@Param('bookId', new ParseUUIDPipe()) bookId: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.books.removeRating(bookId, user.userId);
  }
}
