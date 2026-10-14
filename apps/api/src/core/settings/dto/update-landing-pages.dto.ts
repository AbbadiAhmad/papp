import { IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * PUT /settings/landing-pages body. `null` resets that audience to the
 * platform default; omitting a field leaves it unchanged. Non-null values are
 * re-validated against the installed modules' routes in LandingService.
 */
export class UpdateLandingPagesDto {
  @IsOptional()
  @ValidateIf((dto: UpdateLandingPagesDto) => dto.anonymous !== null)
  @IsString()
  anonymous?: string | null;

  @IsOptional()
  @ValidateIf((dto: UpdateLandingPagesDto) => dto.authenticated !== null)
  @IsString()
  authenticated?: string | null;
}
