import { IsUUID } from 'class-validator';

export class BorrowDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  bookCopyId!: string;
}
