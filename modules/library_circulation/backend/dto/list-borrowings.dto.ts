import { IsBooleanString, IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const BORROWING_STATUSES = ['active', 'returned', 'overdue', 'lost', 'cancelled'] as const;

/**
 * Borrowings status page's filter bar (user request: "a page to track
 * borrowed book status... book name, borrowing reader, date of borrow,
 * estimated date of return, overdue by days"), all optional, combined with
 * AND — same shape/style as `ListFinesDto`. `overdueOnly` is a distinct
 * flag from `status` (rather than a `status=overdue` value) because
 * "overdue" is NEVER actually persisted as a status value on this platform
 * (LIBRARY_CIRCULATION-D4 — no scheduler exists; lateness is computed live
 * from `dueAt < now()` for still-active borrowings) — filtering by it means
 * `status IN ('active') AND dueAt < now()`, not a literal status match.
 */
export class ListBorrowingsDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  /** Substring match on the book's own title OR the copy's qrCode — resolved server-side to a set of bookCopyIds. */
  @IsOptional()
  @IsString()
  bookSearch?: string;

  @IsOptional()
  @IsIn(BORROWING_STATUSES)
  status?: string;

  /** See this DTO's own docblock — `status=active` is implied when true, never a real "overdue" status value. */
  @IsOptional()
  @IsBooleanString()
  overdueOnly?: string;

  @IsOptional()
  @IsDateString()
  borrowedFrom?: string;

  @IsOptional()
  @IsDateString()
  borrowedTo?: string;
}
