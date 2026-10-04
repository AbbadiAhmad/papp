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
exports.ListCopiesForInventoryDto = void 0;
const client_1 = require("@prisma/client");
const class_validator_1 = require("class-validator");
/**
 * Copies inventory page's filter bar (user request: "a page to show the
 * available copies, (book name, copy code, location, status) ... to help
 * the librarian on the Annual inventory") — all optional, combined with
 * AND. Unlike `ListCopiesForPrintDto` (date-range only, for the sticker/
 * export workflow), this filters by `status`/`location`/book title — the
 * dimensions an inventory walkthrough actually needs ("what's SUPPOSED to
 * be on this shelf, and what state is it in"), not acquisition date.
 */
class ListCopiesForInventoryDto {
    /** Substring match on the book's own title. */
    bookSearch;
    status;
    /** Substring match on the copy's own `location`. */
    location;
}
exports.ListCopiesForInventoryDto = ListCopiesForInventoryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ListCopiesForInventoryDto.prototype, "bookSearch", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(client_1.LibraryCatalogBookCopyStatus),
    __metadata("design:type", String)
], ListCopiesForInventoryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ListCopiesForInventoryDto.prototype, "location", void 0);
