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
exports.CreateStageDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * `stageOrder` is the fixed position of this stage within its group's
 * progression (unique per group, enforced by the migration's `UNIQUE
 * (group_id, stage_order)`). `targetAmount` is THIS stage's own amount, not
 * cumulative — "stage 1 = 5 books, stage 2 = an additional 10 books" is
 * targetAmount 5 then 10.
 */
class CreateStageDto {
    stageOrder;
    name;
    targetType;
    targetAmount;
    rewardDescription;
}
exports.CreateStageDto = CreateStageDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateStageDto.prototype, "stageOrder", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], CreateStageDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['books', 'pages']),
    __metadata("design:type", String)
], CreateStageDto.prototype, "targetType", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateStageDto.prototype, "targetAmount", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateStageDto.prototype, "rewardDescription", void 0);
