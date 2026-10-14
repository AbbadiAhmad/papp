import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

/** All optional. `from`/`to` are inclusive, date-only; they limit borrowings, returns, fines and new readers. */
export class StatisticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Width of one age group in years (2 -> 6-7, 8-9, ...). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  ageBandYears?: number;

  /** A book needs at least this many ratings to appear in "highest rated". */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  minRatings?: number;

  /** Length of the top-N lists. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  top?: number;
}
