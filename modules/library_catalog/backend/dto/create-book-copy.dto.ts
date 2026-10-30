import { LibraryCatalogBookCopyStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

/**
 * docs/LIBRARY_MODULE_REQUIREMENTS.md §5. `status` defaults to 'available'
 * server-side when omitted. `qrCode` is also optional as of
 * LIBRARY_CATALOG-D22 — when left blank, `BooksService.createCopy()`
 * auto-assigns the next sequence-backed `Bxxxxxx` code instead of requiring
 * the librarian to type one in by hand.
 */
export class CreateBookCopyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  qrCode?: string;

  @IsOptional()
  @IsEnum(LibraryCatalogBookCopyStatus)
  status?: LibraryCatalogBookCopyStatus;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsDateString()
  acquisitionDate?: string;
  /** Staff-only note (LIBRARY_CATALOG-D35); empty clears it. Needs `library_catalog.notes.view`, checked in the controller. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNote?: string;

}
