import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { BooksService } from './books.service';
import { CreateBookCopyDto } from './dto/create-book-copy.dto';
import { CreateBookDto } from './dto/create-book.dto';
import { ListBooksDto } from './dto/list-books.dto';
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
 * `ratings/*` moderation routes, and the nested `:bookId/copies...` routes
 * are all declared BEFORE `:id` so Express never mistakes a literal
 * single-segment path (or a copies sub-path) for a book id (the same lesson
 * apps/api/src/core/users/users.module.ts's docblock explains).
 */
@Controller('api/library/books')
@UseGuards(MustChangePasswordGuard)
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Get()
  @RequirePermission('library_catalog.books.view')
  async list(@Query() query: ListBooksDto) {
    return this.books.list(query);
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
    return this.books.findById(id, user.userId);
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
    return this.books.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_catalog.books.delete')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBook', action: 'delete', fetchState: fetchBookState })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.books.remove(id);
  }

  // --- Copies --------------------------------------------------------------
  // Gated by the SAME books.* permissions (docs/MODULE_SPEC.md's own worked
  // example declares no separate copies.* codes — copies are a sub-entity of
  // Books, not an independently-permissioned domain, per
  // docs/LIBRARY_MODULE_REQUIREMENTS.md §5).

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
