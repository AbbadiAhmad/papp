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
exports.SubmitResponseDto = exports.AnswerInputDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class AnswerInputDto {
    questionId;
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
    value;
}
exports.AnswerInputDto = AnswerInputDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], AnswerInputDto.prototype, "questionId", void 0);
__decorate([
    (0, class_validator_1.IsDefined)(),
    __metadata("design:type", Object)
], AnswerInputDto.prototype, "value", void 0);
/**
 * The one and only write the respondent-facing flow ever makes before
 * submit — see TakeSurveyPage's own docblock for why nothing partial is
 * ever sent before this.
 */
class SubmitResponseDto {
    answers;
}
exports.SubmitResponseDto = SubmitResponseDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(0),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => AnswerInputDto),
    __metadata("design:type", Array)
], SubmitResponseDto.prototype, "answers", void 0);
