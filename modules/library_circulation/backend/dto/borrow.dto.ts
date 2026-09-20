import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class BorrowDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  bookCopyId!: string;

  @IsOptional()
  @IsDateString()
  expectedReturnDate?: string;

  @IsOptional()
  @IsString()
  comments?: string;
}
