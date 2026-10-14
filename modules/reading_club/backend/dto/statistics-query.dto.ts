import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** All optional. `from`/`to` are inclusive, date-only, and limit borrowings, completions and club book entries. */
export class StatisticsQueryDto {
  /** Club episode for the club section; omitted = the current episode. */
  @IsOptional()
  @IsUUID()
  episodeId?: string;

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
