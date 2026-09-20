import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { BooksService } from './books.service';
import { CreateBookCopyDto } from './dto/create-book-copy.dto';
import { CreateBookDto } from './dto/create-book.dto';
import { ListBooksDto } from './dto/list-books.dto';
import { UpdateBookCopyDto } from './dto/update-book-copy.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { Audit, MustChangePasswordGuard, RequirePermission } from './platform';

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
 * Route registration order matters within one controller: `export` and the
 * nested `:bookId/copies...` routes are declared BEFORE `:id` so Express
 * never mistakes "export" or a copies sub-path for a book id (the same
 * lesson apps/api/src/core/users/users.module.ts's docblock explains).
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

  @Get(':id')
  @RequirePermission('library_catalog.books.view')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.books.findById(id);
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
}
