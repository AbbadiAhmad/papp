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
exports.ReplaceBlocksDto = exports.BlockInputDto = exports.WEBSITE_BLOCK_TYPES = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
/** No raw-HTML block type on purpose — see the module's own DOCUMENTATION.md. */
exports.WEBSITE_BLOCK_TYPES = ['hero', 'text', 'image', 'columns', 'button', 'spacer'];
class BlockInputDto {
    /** Always present, client-generated (`crypto.randomUUID()`) for a brand-new block exactly like an existing one — same pattern as survey's structure endpoint, no server-side temp-id resolution needed. */
    id;
    orderIndex;
    type;
    /**
     * Shape depends on `type` (e.g. text: { markdown }; hero: { heading,
     * subheading, imageUrl }; button: { label, url }) — validated loosely
     * here (just "must be present") since NestJS's global
     * `ValidationPipe({ whitelist: true })` silently STRIPS any property with
     * no validator at all (see papp-add-feature SKILL.md's gotcha #1); the
     * per-type shape is enforced by the admin UI's own form fields, not the
     * backend, matching this module's "simple, not exhaustive" scope.
     */
    config;
}
exports.BlockInputDto = BlockInputDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], BlockInputDto.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], BlockInputDto.prototype, "orderIndex", void 0);
__decorate([
    (0, class_validator_1.IsIn)(exports.WEBSITE_BLOCK_TYPES),
    __metadata("design:type", String)
], BlockInputDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsDefined)(),
    __metadata("design:type", Object)
], BlockInputDto.prototype, "config", void 0);
class ReplaceBlocksDto {
    blocks;
}
exports.ReplaceBlocksDto = ReplaceBlocksDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(0),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => BlockInputDto),
    __metadata("design:type", Array)
], ReplaceBlocksDto.prototype, "blocks", void 0);
