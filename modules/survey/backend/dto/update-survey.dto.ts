import { IsArray, IsBoolean, IsDateString, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_RESPONSE_LIMIT, MAX_THANK_YOU_LENGTH } from '../survey-settings';

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

  /** ISO date-time; `null` clears the schedule. The survey takes responses only from this moment (when set). */
  @IsOptional()
  @IsDateString()
  opensAt?: string | null;

  /** ISO date-time; `null` clears it. From this moment the survey stops taking responses (when set). */
  @IsOptional()
  @IsDateString()
  closesAt?: string | null;

  /** Stop taking NEW responses after this many; `null` removes the cap. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RESPONSE_LIMIT)
  responseLimit?: number | null;

  /** Text shown after submit instead of the default; empty string clears it. Stored in `settings`. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_THANK_YOU_LENGTH)
  thankYouMessage?: string;

  /** Show page progress on surveys with more than one section. Stored in `settings`. */
  @IsOptional()
  @IsBoolean()
  showProgressBar?: boolean;

  /** Shown to respondents of a closed survey; empty string clears it (generic message again). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  closedMessage?: string;
}
