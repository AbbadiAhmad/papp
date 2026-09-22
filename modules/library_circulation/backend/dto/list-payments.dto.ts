import { IsDateString, IsOptional, IsString } from 'class-validator';

/** Finance page's Payments tab filters — all optional, combined with AND. */
export class ListPaymentsDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** The fine's own `createdBy` (who recorded the fine) — substring match on the User's name. */
  @IsOptional()
  @IsString()
  createdByName?: string;

  /** The payment's own `receivedBy` (who recorded the payment) — substring match on the User's name. */
  @IsOptional()
  @IsString()
  receivedByName?: string;
}
