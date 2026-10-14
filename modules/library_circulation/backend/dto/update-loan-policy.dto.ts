import { IsIn, IsInt, IsNumber, Min } from 'class-validator';

export class UpdateLoanPolicyDto {
  @IsInt()
  @Min(1)
  maxBooksPerStudent!: number;

  @IsInt()
  @Min(1)
  loanPeriodDays!: number;

  /** Late fine per unit (see `fineUnit`); decimals allowed, e.g. 0.5. 0 = no automatic late fine. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  finePerDay!: number;

  /** What `finePerDay` is charged per: each day late, or each started week late. */
  @IsIn(['day', 'week'])
  fineUnit!: 'day' | 'week';

  /** Highest late fine for one borrowing; 0 = no limit. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxFine!: number;
}
