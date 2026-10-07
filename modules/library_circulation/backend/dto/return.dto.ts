import { IsBoolean, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum ReturnStatus {
  returned = 'returned',
  damaged = 'damaged',
  lost = 'lost',
  other = 'other',
}

/** Return dialog's extendable "add fine" checkbox — created in the SAME request/transaction as the return, not a separate follow-up step. */
export class ReturnFineDto {
  @IsUUID()
  fineTypeId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * "Paid now": the fine is recorded AND paid in full in this same request (most readers pay at the desk, so
   * two steps — create, then pay — would just be friction). Requires `finance.record_payment`; the unpaid
   * default keeps the old behaviour for anyone who doesn't send it.
   */
  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  @IsIn(['cash', 'card', 'transfer'])
  paymentMethod?: 'cash' | 'card' | 'transfer';
}

export class ReturnDto {
  @IsUUID()
  borrowingId!: string;

  @IsOptional()
  @IsEnum(ReturnStatus)
  returnStatus?: ReturnStatus;

  @IsOptional()
  @IsString()
  returnNotes?: string;

  /** Backdating support — defaults to "now" server-side when omitted. */
  @IsOptional()
  @IsDateString()
  returnedAt?: string;

  @IsOptional()
  @Type(() => ReturnFineDto)
  @ValidateNested()
  fine?: ReturnFineDto;
}
