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
exports.UpdateSurveyDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * Covers both the survey's descriptive fields and its sharing/access
 * settings (docs/DECISIONS.md) — one PATCH endpoint, not split per concern,
 * matching the builder UI's own single "Settings" panel.
 */
class UpdateSurveyDto {
    title;
    description;
    requiresLogin;
    allowEditAfterSubmit;
    oneResponsePerRespondent;
    notifyOwnerOnSubmit;
    /**
     * Arbitrary admin-typed addresses — the module-owned exception to D21
     * confirmed with the user (docs/DECISIONS.md D64). Each entry validated as
     * a real email address; never resolved against the users table.
     */
    notifyEmails;
    opensAt;
    closesAt;
}
exports.UpdateSurveyDto = UpdateSurveyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], UpdateSurveyDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateSurveyDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateSurveyDto.prototype, "requiresLogin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateSurveyDto.prototype, "allowEditAfterSubmit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateSurveyDto.prototype, "oneResponsePerRespondent", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateSurveyDto.prototype, "notifyOwnerOnSubmit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsEmail)({}, { each: true }),
    __metadata("design:type", Array)
], UpdateSurveyDto.prototype, "notifyEmails", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], UpdateSurveyDto.prototype, "opensAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], UpdateSurveyDto.prototype, "closesAt", void 0);
