import { IsDateString, IsUUID } from 'class-validator';

export class ExtendLoanDto {
  @IsUUID()
  borrowingId!: string;

  @IsDateString()
  newDueDate!: string;
}
