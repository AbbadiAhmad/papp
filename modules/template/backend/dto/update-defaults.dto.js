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
exports.UpdateDefaultsDto = void 0;
const class_validator_1 = require("class-validator");
const create_item_dto_1 = require("./create-item.dto");
/**
 * The shape of the `template.defaults` module setting (manifest.json
 * `settings[0]`, docs/MODULE_SPEC.md §8) — demonstrated end-to-end: seeded
 * on install, read by `ItemsService.create` when a caller omits `status`,
 * and editable through `SettingsController` below.
 */
class UpdateDefaultsDto {
    defaultStatus;
}
exports.UpdateDefaultsDto = UpdateDefaultsDto;
__decorate([
    (0, class_validator_1.IsIn)(create_item_dto_1.TEMPLATE_ITEM_STATUSES),
    __metadata("design:type", String)
], UpdateDefaultsDto.prototype, "defaultStatus", void 0);
