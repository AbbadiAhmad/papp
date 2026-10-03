import { IsInt, Min } from 'class-validator';

/** Only meaningful for a `target_type = 'pages'` current stage — see MembershipsService.updateManualProgress's docblock. */
export class UpdateProgressDto {
  @IsInt()
  @Min(0)
  manualProgressAmount!: number;
}
