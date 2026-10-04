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
exports.CreateBookDto = exports.CreateBookCopyInlineDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
/**
 * docs/LIBRARY_MODULE_REQUIREMENTS.md §4's Books field shape — only `title`
 * is required, matching the librarian's own description of the catalog
 * record (everything else is descriptive metadata a librarian may not have
 * on hand yet when first entering a title).
 *
 * Phase A enhancement (LIBRARY_CATALOG-D11): Every book creation includes a
 * mandatory initial copy. If librarian wants more copies, use the existing
 * POST /books/:bookId/copies endpoint.
 *
 * `qrCode` is optional (LIBRARY_CATALOG-D22) — `BooksService.create()`
 * auto-assigns a sequence-backed `Bxxxxxx` code when left blank, same as
 * the standalone `CreateBookCopyDto`.
 */
class CreateBookCopyInlineDto {
    qrCode;
    status;
    condition;
    location;
    acquisitionDate;
}
exports.CreateBookCopyInlineDto = CreateBookCopyInlineDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], CreateBookCopyInlineDto.prototype, "qrCode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(client_1.LibraryCatalogBookCopyStatus),
    __metadata("design:type", String)
], CreateBookCopyInlineDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookCopyInlineDto.prototype, "condition", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookCopyInlineDto.prototype, "location", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateBookCopyInlineDto.prototype, "acquisitionDate", void 0);
class CreateBookDto {
    title;
    author;
    publisher;
    category;
    readingLevel;
    language;
    description;
    coverImage;
    /** Optional (LIBRARY_CATALOG-D24) — reading_club sums this across a reader's stage book entries to auto-compute a `pages`-type stage's progress. */
    pageCount;
    copy;
}
exports.CreateBookDto = CreateBookDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], CreateBookDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookDto.prototype, "author", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookDto.prototype, "publisher", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookDto.prototype, "category", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookDto.prototype, "readingLevel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookDto.prototype, "language", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBookDto.prototype, "coverImage", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsPositive)(),
    __metadata("design:type", Number)
], CreateBookDto.prototype, "pageCount", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_transformer_1.Type)(() => CreateBookCopyInlineDto),
    (0, class_validator_1.ValidateNested)(),
    __metadata("design:type", CreateBookCopyInlineDto)
], CreateBookDto.prototype, "copy", void 0);
