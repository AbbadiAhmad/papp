import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Dashboard's overdue-books table: sorting + paging. */
export class ListOverdueDto {
  @IsOptional()
  @IsIn(['studentName', 'bookTitle', 'borrowedAt', 'dueAt', 'daysOverdue'])
  sortBy?: 'studentName' | 'bookTitle' | 'borrowedAt' | 'dueAt' | 'daysOverdue';

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
