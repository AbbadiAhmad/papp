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
exports.UpdateStickerLayoutDto = void 0;
const class_validator_1 = require("class-validator");
/** The layout is validated and completed by `normalizeLayout` (sticker-layout.ts); the decorators only keep the whitelist from stripping it. */
class UpdateStickerLayoutDto {
    layout;
}
exports.UpdateStickerLayoutDto = UpdateStickerLayoutDto;
__decorate([
    (0, class_validator_1.IsDefined)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], UpdateStickerLayoutDto.prototype, "layout", void 0);
