import { IsArray, IsBoolean, IsDateString, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Covers both the survey's descriptive fields and its sharing/access
 * settings (docs/DECISIONS.md) — one PATCH endpoint, not split per concern,
 * matching the builder UI's own single "Settings" panel.
 */
export class UpdateSurveyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  requiresLogin?: boolean;

  @IsOptional()
  @IsBoolean()
  allowEditAfterSubmit?: boolean;

  @IsOptional()
  @IsBoolean()
  oneResponsePerRespondent?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOwnerOnSubmit?: boolean;

  /**
   * Arbitrary admin-typed addresses — the module-owned exception to D21
   * confirmed with the user (docs/DECISIONS.md D64). Each entry validated as
   * a real email address; never resolved against the users table.
   */
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  notifyEmails?: string[];

  @IsOptional()
  @IsDateString()
  opensAt?: string;

  @IsOptional()
  @IsDateString()
  closesAt?: string;

  /** Shown to respondents of a closed survey; empty string clears it (generic message again). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  closedMessage?: string;
}
