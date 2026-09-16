import { IsOptional, IsString } from 'class-validator';

/** Optional filters for `GET /api/library/books` — a plain title/category search, no pagination yet (small catalogs). */
export class ListBooksDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
