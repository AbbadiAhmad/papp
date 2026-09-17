import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateFineDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  fineTypeId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsUUID()
  borrowingId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Required true to proceed when an identical open fine already exists (§14/§22). */
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}
