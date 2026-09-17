import { IsInt, Min } from 'class-validator';

export class UpdateLoanPolicyDto {
  @IsInt()
  @Min(1)
  maxBooksPerStudent!: number;

  @IsInt()
  @Min(1)
  loanPeriodDays!: number;

  @IsInt()
  @Min(0)
  finePerDay!: number;
}
