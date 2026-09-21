import { IsDateString, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

/** Fines page's filter bar — all optional, combined with AND. */
export class ListFinesDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsString()
  status?: string;

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
