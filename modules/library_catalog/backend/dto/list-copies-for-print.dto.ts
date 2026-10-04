import { IsDateString, IsOptional } from 'class-validator';

/**
 * Filter for `GET /books/copies/stickers` and its `/export` counterpart
 * (LIBRARY_CATALOG-D22) — "filter the books entered last period (they
 * define the dates)". Both bounds are optional and inclusive; omitting both
 * returns every copy (the controller/service don't impose a default range).
 */
export class ListCopiesForPrintDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
