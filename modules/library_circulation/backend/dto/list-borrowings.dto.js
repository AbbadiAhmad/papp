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
exports.ListBorrowingsDto = void 0;
const class_validator_1 = require("class-validator");
const BORROWING_STATUSES = ['active', 'returned', 'overdue', 'lost', 'cancelled'];
/**
 * Borrowings status page's filter bar (user request: "a page to track
 * borrowed book status... book name, borrowing reader, date of borrow,
 * estimated date of return, overdue by days"), all optional, combined with
 * AND — same shape/style as `ListFinesDto`. `overdueOnly` is a distinct
 * flag from `status` (rather than a `status=overdue` value) because
 * "overdue" is NEVER actually persisted as a status value on this platform
 * (LIBRARY_CIRCULATION-D4 — no scheduler exists; lateness is computed live
 * from `dueAt < now()` for still-active borrowings) — filtering by it means
 * `status IN ('active') AND dueAt < now()`, not a literal status match.
 */
class ListBorrowingsDto {
    studentId;
    /** Substring match on the book's own title OR the copy's qrCode — resolved server-side to a set of bookCopyIds. */
    bookSearch;
    status;
    /** See this DTO's own docblock — `status=active` is implied when true, never a real "overdue" status value. */
    overdueOnly;
    borrowedFrom;
    borrowedTo;
}
exports.ListBorrowingsDto = ListBorrowingsDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ListBorrowingsDto.prototype, "studentId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ListBorrowingsDto.prototype, "bookSearch", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(BORROWING_STATUSES),
    __metadata("design:type", String)
], ListBorrowingsDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBooleanString)(),
    __metadata("design:type", String)
], ListBorrowingsDto.prototype, "overdueOnly", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], ListBorrowingsDto.prototype, "borrowedFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], ListBorrowingsDto.prototype, "borrowedTo", void 0);
