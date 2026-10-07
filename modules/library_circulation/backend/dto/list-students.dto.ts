import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Readers table's filter bar + paging — all optional, combined with AND. */
export class ListStudentsDto {
  /** Free text: matches code, class, or the linked account's name / email / external ID / department. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  className?: string;

  @IsOptional()
  @IsIn(['all', 'active', 'inactive'])
  status?: 'all' | 'active' | 'inactive';

  /** out = has at least one book out; overdue = has a late book; none = nothing out. */
  @IsOptional()
  @IsIn(['all', 'out', 'overdue', 'none'])
  borrowing?: 'all' | 'out' | 'overdue' | 'none';

  @IsOptional()
  @IsIn(['createdAt', 'code', 'className'])
  sortBy?: 'createdAt' | 'code' | 'className';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
