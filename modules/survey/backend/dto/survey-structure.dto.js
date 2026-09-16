"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurveyStructureDto = exports.LogicRuleInputDto = exports.SectionInputDto = exports.QuestionInputDto = exports.QuestionOptionInputDto = exports.ENUMERATION_QUESTION_TYPES = exports.SURVEY_QUESTION_TYPES = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
/** v1 core set — file upload and question grids are explicitly deferred. */
exports.SURVEY_QUESTION_TYPES = [
    'short_text',
    'paragraph',
    'single_choice',
    'multi_choice',
    'dropdown',
    'linear_scale',
    'date',
    'time',
    'rating',
];
exports.ENUMERATION_QUESTION_TYPES = [
    'single_choice',
    'multi_choice',
    'dropdown',
];
class QuestionOptionInputDto {
    /**
     * Always present, client-generated (`crypto.randomUUID()`) for a
     * brand-new option exactly like an existing one — see SectionInputDto's
     * own comment for why this sidesteps needing any server-side temp-id
     * resolution.
     */
    id;
    orderIndex;
    value;
    label;
}
exports.QuestionOptionInputDto = QuestionOptionInputDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], QuestionOptionInputDto.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], QuestionOptionInputDto.prototype, "orderIndex", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], QuestionOptionInputDto.prototype, "value", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], QuestionOptionInputDto.prototype, "label", void 0);
class QuestionInputDto {
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
    id;
    orderIndex;
    type;
    title;
    description;
    required;
    /**
     * Type-specific shape, validated against `type` at the SERVICE layer
     * (SurveysService.validateQuestionConfig) rather than as a discriminated-
     * union DTO — keeps this file from needing nine near-identical nested DTO
     * classes for what is, per question, at most 3-4 simple keys. e.g.
     * linear_scale: {min,max,minLabel,maxLabel}; rating: {max}; every other
     * type: {} (no config needed).
     */
    config;
    options;
}
exports.QuestionInputDto = QuestionInputDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], QuestionInputDto.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], QuestionInputDto.prototype, "orderIndex", void 0);
__decorate([
    (0, class_validator_1.IsIn)(exports.SURVEY_QUESTION_TYPES),
    __metadata("design:type", String)
], QuestionInputDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], QuestionInputDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], QuestionInputDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], QuestionInputDto.prototype, "required", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], QuestionInputDto.prototype, "config", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => QuestionOptionInputDto),
    __metadata("design:type", Array)
], QuestionInputDto.prototype, "options", void 0);
class SectionInputDto {
    /**
     * Always present, client-generated (`crypto.randomUUID()`) for a
     * brand-new section exactly like an existing one — see QuestionInputDto's
     * own comment for the full rationale (no server-side temp-id resolution
     * needed anywhere in this save endpoint).
     */
    id;
    orderIndex;
    title;
    description;
    questions;
}
exports.SectionInputDto = SectionInputDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], SectionInputDto.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], SectionInputDto.prototype, "orderIndex", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], SectionInputDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SectionInputDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => QuestionInputDto),
    __metadata("design:type", Array)
], SectionInputDto.prototype, "questions", void 0);
class LogicRuleInputDto {
    /**
     * A question's real `id` from the SAME payload's `sections` tree — always
     * a real UUID even for a brand-new question (see QuestionInputDto's own
     * comment), so no server-side id remapping is needed here either.
     * Existence within this exact save is validated at the service layer (a
     * rule pointing at a question/section id absent from this payload is
     * rejected).
     */
    sourceQuestionId;
    sourceOptionValue;
    action;
    targetType;
    targetId;
    orderIndex;
}
exports.LogicRuleInputDto = LogicRuleInputDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], LogicRuleInputDto.prototype, "sourceQuestionId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], LogicRuleInputDto.prototype, "sourceOptionValue", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['show', 'hide']),
    __metadata("design:type", String)
], LogicRuleInputDto.prototype, "action", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['section', 'question']),
    __metadata("design:type", String)
], LogicRuleInputDto.prototype, "targetType", void 0);
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], LogicRuleInputDto.prototype, "targetId", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], LogicRuleInputDto.prototype, "orderIndex", void 0);
/**
 * The whole-tree replace payload for `PUT /api/survey/surveys/:id/structure`
 * (docs/DECISIONS.md — one save endpoint instead of granular per-section/
 * question CRUD, matching how a form builder actually saves: the whole
 * canvas state at once).
 */
class SurveyStructureDto {
    sections;
    logicRules;
}
exports.SurveyStructureDto = SurveyStructureDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => SectionInputDto),
    __metadata("design:type", Array)
], SurveyStructureDto.prototype, "sections", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => LogicRuleInputDto),
    __metadata("design:type", Array)
], SurveyStructureDto.prototype, "logicRules", void 0);
