import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Upserts the CALLER'S OWN rating for a book — one row per (book, user), editable (LIBRARY_CATALOG-D20). */
export class RateBookDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  review?: string;
}
