import { LibraryCatalogBookCopyStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Copies inventory page's filter bar (user request: "a page to show the
 * available copies, (book name, copy code, location, status) ... to help
 * the librarian on the Annual inventory") — all optional, combined with
 * AND. Unlike `ListCopiesForPrintDto` (date-range only, for the sticker/
 * export workflow), this filters by `status`/`location`/book title — the
 * dimensions an inventory walkthrough actually needs ("what's SUPPOSED to
 * be on this shelf, and what state is it in"), not acquisition date.
 */
export class ListCopiesForInventoryDto {
  /** Substring match on the book's own title. */
  @IsOptional()
  @IsString()
  bookSearch?: string;

  @IsOptional()
  @IsEnum(LibraryCatalogBookCopyStatus)
  status?: LibraryCatalogBookCopyStatus;

  /** Substring match on the copy's own `location`. */
  @IsOptional()
  @IsString()
  location?: string;
}
