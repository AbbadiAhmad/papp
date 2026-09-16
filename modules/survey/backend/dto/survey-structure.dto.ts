import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** v1 core set — file upload and question grids are explicitly deferred. */
export const SURVEY_QUESTION_TYPES = [
  'short_text',
  'paragraph',
  'single_choice',
  'multi_choice',
  'dropdown',
  'linear_scale',
  'date',
  'time',
  'rating',
] as const;
export type SurveyQuestionTypeValue = (typeof SURVEY_QUESTION_TYPES)[number];

export const ENUMERATION_QUESTION_TYPES: readonly SurveyQuestionTypeValue[] = [
  'single_choice',
  'multi_choice',
  'dropdown',
];

export class QuestionOptionInputDto {
  /**
   * Always present, client-generated (`crypto.randomUUID()`) for a
   * brand-new option exactly like an existing one — see SectionInputDto's
   * own comment for why this sidesteps needing any server-side temp-id
   * resolution.
   */
  @IsUUID()
  id!: string;

  @IsInt()
  orderIndex!: number;

  @IsString()
  @MinLength(1)
  value!: string;

  @IsString()
  @MinLength(1)
  label!: string;
}

export class QuestionInputDto {
  /**
   * Always present, client-generated (`crypto.randomUUID()`) for a
   * brand-new question exactly like an existing one — the frontend builder
   * assigns a real UUID the moment a question/section/option is added to
   * the canvas, never a temporary placeholder id. This means the backend
   * can always `upsert` by id (an id that doesn't exist yet in the DB is
   * simply a create) with NO server-side temp-id-to-real-id remapping step,
   * and `LogicRuleInputDto` below can reference a same-payload brand-new
   * question's real id directly, even before this save request is sent.
   * An existing question's id is preserved across edits so its
   * `survey_answers` rows and any logic rules pointing at it stay linked; a
   * question NOT present in this payload is deleted along with its options
   * (answers cascade-delete too, per the migration's ON DELETE CASCADE).
   */
  @IsUUID()
  id!: string;

  @IsInt()
  orderIndex!: number;

  @IsIn(SURVEY_QUESTION_TYPES)
  type!: SurveyQuestionTypeValue;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  /**
   * Type-specific shape, validated against `type` at the SERVICE layer
   * (SurveysService.validateQuestionConfig) rather than as a discriminated-
   * union DTO — keeps this file from needing nine near-identical nested DTO
   * classes for what is, per question, at most 3-4 simple keys. e.g.
   * linear_scale: {min,max,minLabel,maxLabel}; rating: {max}; every other
   * type: {} (no config needed).
   */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionInputDto)
  options?: QuestionOptionInputDto[];
}

export class SectionInputDto {
  /**
   * Always present, client-generated (`crypto.randomUUID()`) for a
   * brand-new section exactly like an existing one — see QuestionInputDto's
   * own comment for the full rationale (no server-side temp-id resolution
   * needed anywhere in this save endpoint).
   */
  @IsUUID()
  id!: string;

  @IsInt()
  orderIndex!: number;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionInputDto)
  questions!: QuestionInputDto[];
}

export class LogicRuleInputDto {
  /**
   * A question's real `id` from the SAME payload's `sections` tree — always
   * a real UUID even for a brand-new question (see QuestionInputDto's own
   * comment), so no server-side id remapping is needed here either.
   * Existence within this exact save is validated at the service layer (a
   * rule pointing at a question/section id absent from this payload is
   * rejected).
   */
  @IsUUID()
  sourceQuestionId!: string;

  @IsString()
  @MinLength(1)
  sourceOptionValue!: string;

  @IsIn(['show', 'hide'])
  action!: 'show' | 'hide';

  @IsIn(['section', 'question'])
  targetType!: 'section' | 'question';

  @IsUUID()
  targetId!: string;

  @IsInt()
  orderIndex!: number;
}

/**
 * The whole-tree replace payload for `PUT /api/survey/surveys/:id/structure`
 * (docs/DECISIONS.md — one save endpoint instead of granular per-section/
 * question CRUD, matching how a form builder actually saves: the whole
 * canvas state at once).
 */
export class SurveyStructureDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SectionInputDto)
  sections!: SectionInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LogicRuleInputDto)
  logicRules?: LogicRuleInputDto[];
}
