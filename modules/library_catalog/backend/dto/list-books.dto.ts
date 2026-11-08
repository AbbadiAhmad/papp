import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

const COPY_STATUSES = ['available', 'borrowed', 'lost', 'damaged', 'maintenance', 'reserved'] as const;

const SORT_FIELDS = ['createdAt', 'title', 'author', 'category'] as const;

/** Optional filters for `GET /api/library/books` — no pagination yet (small catalogs). */
export class ListBooksDto {
  /** Matches the title OR any of the book's copy codes. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  readingLevel?: string;

  /** Default `createdAt` (newest added first). */
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number];

  /** Default: descending for `createdAt`, ascending for the text fields. */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  /**
   * Multi-select: only books with at least one copy in ANY of these statuses
   * (`?copyStatus=damaged,lost`, comma-separated like the fines status filter).
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value))
  @IsArray()
  @IsIn(COPY_STATUSES, { each: true })
  copyStatus?: string[];
}
