import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * `stageOrder` is the fixed position of this stage within its group's
 * progression (unique per group, enforced by the migration's `UNIQUE
 * (group_id, stage_order)`). `targetAmount` is THIS stage's own amount, not
 * cumulative — "stage 1 = 5 books, stage 2 = an additional 10 books" is
 * targetAmount 5 then 10.
 */
export class CreateStageDto {
  @IsInt()
  @Min(1)
  stageOrder!: number;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(['books', 'pages'])
  targetType!: 'books' | 'pages';

  @IsInt()
  @Min(1)
  targetAmount!: number;

  @IsOptional()
  @IsString()
  rewardDescription?: string;
}
