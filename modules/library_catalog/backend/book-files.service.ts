import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { BookFileKind, MAX_IMAGES_PER_BOOK, downloadName, validateUpload } from './book-file-rules';

export interface BookFilesSummary {
  cover: { ext: string; sizeBytes: number; updatedAt: Date } | null;
  book: { ext: string; sizeBytes: number; updatedAt: Date } | null;
  /** Extra gallery pictures, oldest first (LIBRARY_CATALOG-D30). */
  images: { id: string; ext: string; sizeBytes: number }[];
}

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
@Injectable()
export class BookFilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookFilesService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /** Read on every call so a deployment (and a test) can point it elsewhere. */
  rootDir(): string {
    return process.env.BOOK_FILES_DIR || join(process.cwd(), 'data', 'books_files');
  }

  private folder(bookId: string): string {
    return join(this.rootDir(), bookId);
  }

  private pathOf(bookId: string, kind: BookFileKind, ext: string): string {
    return join(this.folder(bookId), `${kind}.${ext}`);
  }

  async upload(bookId: string, kind: BookFileKind, bytes: Uint8Array | undefined, userId: string | null): Promise<BookFilesSummary> {
    const book = await this.prisma.libraryCatalogBook.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Book not found');
    const checked = validateUpload(kind, bytes);
    if ('error' in checked) throw new BadRequestException(checked.error);
    const { ext, mime } = checked.file;

    await fs.mkdir(this.folder(bookId), { recursive: true });
    const target = this.pathOf(bookId, kind, ext);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, bytes as Uint8Array);
    await fs.rename(temp, target);

    const previous = await this.prisma.libraryCatalogBookFile.findUnique({ where: { bookId_kind: { bookId, kind } } });
    await this.prisma.libraryCatalogBookFile.upsert({
      where: { bookId_kind: { bookId, kind } },
      create: { bookId, kind, ext, mime, sizeBytes: bytes!.length, uploadedBy: userId },
      update: { ext, mime, sizeBytes: bytes!.length, uploadedBy: userId },
    });
    if (previous && previous.ext !== ext) await fs.rm(this.pathOf(bookId, kind, previous.ext), { force: true });
    await this.writeInfo(bookId);
    return this.summary(bookId);
  }

  async remove(bookId: string, kind: BookFileKind): Promise<void> {
    const row = await this.prisma.libraryCatalogBookFile.findUnique({ where: { bookId_kind: { bookId, kind } } });
    if (!row) throw new NotFoundException('There is no such file for this book');
    await this.prisma.libraryCatalogBookFile.delete({ where: { id: row.id } });
    await fs.rm(this.pathOf(bookId, kind, row.ext), { force: true });
    const left = await this.prisma.libraryCatalogBookFile.count({ where: { bookId } });
    if (left === 0) await fs.rm(this.folder(bookId), { recursive: true, force: true });
  }

  /** Called after a book is deleted: its rows are gone by cascade, so remove the folder. */
  async removeAll(bookId: string): Promise<void> {
    await fs.rm(this.folder(bookId), { recursive: true, force: true });
  }

  async summary(bookId: string): Promise<BookFilesSummary> {
    return (await this.summaries([bookId])).get(bookId) ?? { cover: null, book: null, images: [] };
  }

  async summaries(bookIds: string[]): Promise<Map<string, BookFilesSummary>> {
    const map = new Map<string, BookFilesSummary>();
    if (bookIds.length === 0) return map;
    const rows = await this.prisma.libraryCatalogBookFile.findMany({ where: { bookId: { in: bookIds } } });
    for (const row of rows) {
      const entry = map.get(row.bookId) ?? { cover: null, book: null, images: [] };
      entry[row.kind as 'cover' | 'book'] = { ext: row.ext, sizeBytes: row.sizeBytes, updatedAt: row.updatedAt };
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

  private imagePath(bookId: string, imageId: string, ext: string): string {
    return join(this.folder(bookId), 'images', `${imageId}.${ext}`);
  }

  /** Adds one gallery picture (same type/size rules as the cover); at most MAX_IMAGES_PER_BOOK per book. */
  async addImage(bookId: string, bytes: Uint8Array | undefined, userId: string | null): Promise<BookFilesSummary> {
    const book = await this.prisma.libraryCatalogBook.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Book not found');
    const checked = validateUpload('cover', bytes);
    if ('error' in checked) throw new BadRequestException(checked.error);
    if ((await this.prisma.libraryCatalogBookImage.count({ where: { bookId } })) >= MAX_IMAGES_PER_BOOK) {
      throw new BadRequestException(`A book can have at most ${MAX_IMAGES_PER_BOOK} extra pictures`);
    }
    const { ext, mime } = checked.file;
    const row = await this.prisma.libraryCatalogBookImage.create({ data: { bookId, ext, mime, sizeBytes: bytes!.length, uploadedBy: userId } });
    try {
      await fs.mkdir(join(this.folder(bookId), 'images'), { recursive: true });
      await fs.writeFile(this.imagePath(bookId, row.id, ext), bytes as Uint8Array);
    } catch (err) {
      await this.prisma.libraryCatalogBookImage.delete({ where: { id: row.id } });
      throw err;
    }
    await this.writeInfo(bookId);
    return this.summary(bookId);
  }

  async removeImage(bookId: string, imageId: string): Promise<void> {
    const row = await this.prisma.libraryCatalogBookImage.findUnique({ where: { id: imageId } });
    if (!row || row.bookId !== bookId) throw new NotFoundException('There is no such picture for this book');
    await this.prisma.libraryCatalogBookImage.delete({ where: { id: imageId } });
    await fs.rm(this.imagePath(bookId, imageId, row.ext), { force: true });
  }

  async locateImage(bookId: string, imageId: string): Promise<{ path: string; mime: string } | null> {
    const row = await this.prisma.libraryCatalogBookImage.findUnique({ where: { id: imageId } });
    if (!row || row.bookId !== bookId) return null;
    return { path: this.imagePath(bookId, imageId, row.ext), mime: row.mime };
  }

  /** Where a file is, from the DB row only. `downloadAs` is built from the book title, never from the upload. */
  async locate(bookId: string, kind: BookFileKind): Promise<{ path: string; mime: string; downloadAs: { ascii: string; utf8: string } } | null> {
    const row = await this.prisma.libraryCatalogBookFile.findUnique({ where: { bookId_kind: { bookId, kind } }, include: { book: true } });
    if (!row) return null;
    return { path: this.pathOf(bookId, kind, row.ext), mime: row.mime, downloadAs: downloadName(row.book.title, row.ext) };
  }

  /**
   * (Re)writes `info.txt` so someone browsing the disk can tell which book a folder belongs to even if
   * the database link is lost. Best effort: failure is logged, never fails the request.
   */
  async writeInfo(bookId: string): Promise<void> {
    try {
      const book = await this.prisma.libraryCatalogBook.findUnique({ where: { id: bookId } });
      if (!book) return;
      const exists = await fs.stat(this.folder(bookId)).then((s) => s.isDirectory(), () => false);
      if (!exists) return;
      const lines = [
        `Book ID: ${book.id}`,
        `Title: ${book.title}`,
        `Author: ${book.author ?? ''}`,
        `Publisher: ${book.publisher ?? ''}`,
        `Updated: ${new Date().toISOString()}`,
      ];
      await fs.writeFile(join(this.folder(bookId), 'info.txt'), `${lines.join('\n')}\n`, 'utf8');
    } catch (err) {
      this.logger.warn(`could not write info.txt for ${bookId}: ${(err as Error).message}`);
    }
  }
}
