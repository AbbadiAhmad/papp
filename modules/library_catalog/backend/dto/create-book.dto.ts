import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MinLength, ValidateNested } from 'class-validator';
import { LibraryCatalogBookCopyStatus } from '@prisma/client';

/**
 * docs/LIBRARY_MODULE_REQUIREMENTS.md §4's Books field shape — only `title`
 * is required, matching the librarian's own description of the catalog
 * record (everything else is descriptive metadata a librarian may not have
 * on hand yet when first entering a title).
 *
 * Phase A enhancement (LIBRARY_CATALOG-D11): Every book creation includes a
 * mandatory initial copy. If librarian wants more copies, use the existing
 * POST /books/:bookId/copies endpoint.
 *
 * `qrCode` is optional (LIBRARY_CATALOG-D22) — `BooksService.create()`
 * auto-assigns a sequence-backed `Bxxxxxx` code when left blank, same as
 * the standalone `CreateBookCopyDto`.
 */
export class CreateBookCopyInlineDto {
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
}

export class CreateBookDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  readingLevel?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  /** Optional (LIBRARY_CATALOG-D24) — reading_club sums this across a reader's stage book entries to auto-compute a `pages`-type stage's progress. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  pageCount?: number;

  @IsNotEmpty()
  @Type(() => CreateBookCopyInlineDto)
  @ValidateNested()
  copy!: CreateBookCopyInlineDto;
}
