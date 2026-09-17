import { IsIn, IsNumber, Min } from 'class-validator';

export const PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class RecordPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;
}
