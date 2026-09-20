import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export enum ReturnStatus {
  returned = 'returned',
  damaged = 'damaged',
  lost = 'lost',
  other = 'other',
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
}
