import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

/** Manual "books read this stage" entry — a librarian free-types a title (required); everything else is optional. Catalog search-select is a nice-to-have not built in v1 (see DECISIONS.md), so `bookCopyId` stays available for a future enhancement but is not required. */
export class AddBookEntryDto {
  @IsString()
  @MinLength(1)
  bookTitle!: string;

  @IsOptional()
  @IsString()
  bookCode?: string;

  @IsOptional()
  @IsString()
  comments?: string;

  @IsOptional()
  @IsUUID()
  bookCopyId?: string;

  /** Optional (READING_CLUB-D18) — summed into a `pages`-type stage's progress alongside auto-synced entries; left blank for a book with no known page count. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  pageCount?: number;
}
