import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const FINE_STATUSES = ['unpaid', 'partially_paid', 'paid', 'waived', 'cancelled'] as const;

/** Fines page's filter bar — all optional, combined with AND. */
export class ListFinesDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  /**
   * Multi-select status filter (user-reported bug-fix follow-up to
   * LIBRARY_CATALOG-D22-adjacent dashboard-linking work — the dashboard's
   * "unpaid fines" total spans BOTH `unpaid` and `partially_paid`, which a
   * single-status filter couldn't express as one link/URL). Accepted on the
   * wire as a comma-separated string (`?status=unpaid,partially_paid`,
   * simplest to build as a dashboard deep-link's query string) and
   * normalized here to a real `string[]`; `FinesService.list()` matches it
   * with `status: { in: [...] }`. A single value (`?status=paid`) still
   * works, same as before.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value))
  @IsArray()
  @IsIn(FINE_STATUSES, { each: true })
  status?: string[];

  @IsOptional()
  @IsUUID()
  fineTypeId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Substring match on the fine's own createdBy User.name. */
  @IsOptional()
  @IsString()
  createdByName?: string;

  /** Substring match on the reader's own User.name or LibraryStudent.code. */
  @IsOptional()
  @IsString()
  studentSearch?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amountMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amountMax?: number;
}
