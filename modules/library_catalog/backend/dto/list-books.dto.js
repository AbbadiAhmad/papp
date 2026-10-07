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
exports.ListBooksDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const COPY_STATUSES = ['available', 'borrowed', 'lost', 'damaged', 'maintenance', 'reserved'];
/** Optional filters for `GET /api/library/books` — no pagination yet (small catalogs). */
class ListBooksDto {
    /** Matches the title OR any of the book's copy codes. */
    search;
    category;
    /**
     * Multi-select: only books with at least one copy in ANY of these statuses
     * (`?copyStatus=damaged,lost`, comma-separated like the fines status filter).
     */
    copyStatus;
}
exports.ListBooksDto = ListBooksDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ListBooksDto.prototype, "search", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ListBooksDto.prototype, "category", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value)),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsIn)(COPY_STATUSES, { each: true }),
    __metadata("design:type", Array)
], ListBooksDto.prototype, "copyStatus", void 0);
