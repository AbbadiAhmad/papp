import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateStageDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  stageOrder?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['books', 'pages'])
  targetType?: 'books' | 'pages';

  @IsOptional()
  @IsInt()
  @Min(1)
  targetAmount?: number;

  @IsOptional()
  @IsString()
  rewardDescription?: string;
}
