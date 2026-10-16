import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDefined, IsEmail, IsOptional, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class AnswerInputDto {
  @IsUUID()
  questionId!: string;

  /**
   * Shape depends on the question's type (string / string[] / number) — not
   * narrowed further here; ResponsesService.validateAnswers cross-checks
   * each answer's shape against its question's real type, since that
   * requires looking the question up, not just parsing the request body.
   *
   * `@IsDefined()` is REQUIRED here even though it barely constrains
   * anything — main.ts's global `ValidationPipe` runs with `whitelist:
   * true`, which strips any property with NO class-validator decorator at
   * all before the controller ever sees it. Without this, every single
   * submitted answer's `value` was silently dropped (confirmed live: a
   * real submit returned 201 but wrote zero `survey_answers` rows) — this
   * decorator is what keeps `value` in the payload, not a strictness choice.
   */
  @IsDefined()
  value!: unknown;
}

/**
 * The one and only write the respondent-facing flow ever makes before
 * submit — see TakeSurveyPage's own docblock for why nothing partial is
 * ever sent before this.
 */
export class SubmitResponseDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AnswerInputDto)
  answers!: AnswerInputDto[];

  /**
   * Where to email a copy of the answers, for an ANONYMOUS respondent of a survey that offers it. Ignored for a
   * logged-in respondent (their account email is used) and for an invited one (the invited address is used).
   */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  copyToEmail?: string;
}
