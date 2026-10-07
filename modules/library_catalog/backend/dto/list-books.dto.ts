import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

const COPY_STATUSES = ['available', 'borrowed', 'lost', 'damaged', 'maintenance', 'reserved'] as const;

/** Optional filters for `GET /api/library/books` — no pagination yet (small catalogs). */
export class ListBooksDto {
  /** Matches the title OR any of the book's copy codes. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  category?: string;

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
