import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateFineDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
