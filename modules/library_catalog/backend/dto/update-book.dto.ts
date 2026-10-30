import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, MinLength, MaxLength } from 'class-validator';

/** Every field optional — a PATCH only ever touches what's supplied. */
export class UpdateBookDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

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

  /** Optional (LIBRARY_CATALOG-D24) — see CreateBookDto's own docblock. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  pageCount?: number;
  /** Staff-only note (LIBRARY_CATALOG-D35); empty clears it. Needs `library_catalog.notes.view`, checked in the controller. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNote?: string;

}
