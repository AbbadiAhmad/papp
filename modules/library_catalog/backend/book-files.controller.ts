import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { BOOK_FILE_KINDS, BookFileKind, MAX_BOOK_FILE_BYTES, MAX_COVER_BYTES } from './book-file-rules';
import { BookFilesService } from './book-files.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

function parseKind(kind: string): BookFileKind {
  if (!(BOOK_FILE_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('The file kind must be "cover" or "book"');
  return kind as BookFileKind;
}

/**
 * A book's cover picture and its book file (LIBRARY_CATALOG-D28). Upload and delete need
 * `books.update`; downloading the book file needs its own `books.download`. The cover is shown from a
 * public route (PublicBooksController) because an <img> tag cannot send an Authorization header.
 */
@Controller('api/library/books/:id/files')
@UseGuards(MustChangePasswordGuard)
export class BookFilesController {
  constructor(private readonly files: BookFilesService) {}

  // Declared before ':kind' so "images" is never read as a file kind.
  @Post('images')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('library_catalog.books.update')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBookImage', action: 'upload_image' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_COVER_BYTES + 1 } }))
  async addImage(@Param('id', new ParseUUIDPipe()) id: string, @UploadedFile() file: { buffer: Buffer } | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.files.addImage(id, file?.buffer, user.userId);
  }

  @Delete('images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_catalog.books.update')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBookImage', action: 'delete_image' })
  async removeImage(@Param('id', new ParseUUIDPipe()) id: string, @Param('imageId', new ParseUUIDPipe()) imageId: string): Promise<void> {
    await this.files.removeImage(id, imageId);
  }

  @Post(':kind')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('library_catalog.books.update')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBookFile', action: 'upload_file' })
  // +1 so an oversize file reaches the service's own, clearer message instead of a generic 413 (covers have their own, lower, limit there).
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BOOK_FILE_BYTES + 1 } }))
  async upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('kind') kind: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.files.upload(id, parseKind(kind), file?.buffer, user.userId);
  }

  @Delete(':kind')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_catalog.books.update')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBookFile', action: 'delete_file' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Param('kind') kind: string): Promise<void> {
    await this.files.remove(id, parseKind(kind));
  }

  /** The book file, always as a download (never rendered inside the site), named after the book's title. */
  @Get('book')
  @RequirePermission('library_catalog.books.download')
  @Audit({ category: 'library_catalog.books', entityType: 'LibraryCatalogBookFile', action: 'download_file' })
  async download(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const found = await this.files.locate(id, 'book');
    if (!found) throw new NotFoundException('This book has no file');
    res.set({
      'Content-Type': found.mime,
      'Content-Disposition': `attachment; filename="${found.downloadAs.ascii}"; filename*=UTF-8''${encodeURIComponent(found.downloadAs.utf8)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.sendFile(found.path, (err) => {
      if (err && !res.headersSent) res.status(404).json({ statusCode: 404, message: 'File not found' });
    });
  }
}
