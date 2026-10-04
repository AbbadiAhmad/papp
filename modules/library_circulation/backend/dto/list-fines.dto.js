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
exports.ListFinesDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const FINE_STATUSES = ['unpaid', 'partially_paid', 'paid', 'waived', 'cancelled'];
/** Fines page's filter bar — all optional, combined with AND. */
class ListFinesDto {
    studentId;
    /**
     * Multi-select status filter (user-reported bug-fix follow-up to
     * LIBRARY_CATALOG-D22-adjacent dashboard-linking work — the dashboard's
     * "unpaid fines" total spans BOTH `unpaid` and `partially_paid`, which a
     * single-status filter couldn't express as one link/URL). Accepted on the
     * wire as a comma-separated string (`?status=unpaid,partially_paid`,
     * simplest to build as a dashboard deep-link's query string) and
     * normalized here to a real `string[]`; `FinesService.list()` matches it
     * with `status: { in: [...] }`. A single value (`?status=paid`) still
     * works, same as before.
     */
    status;
    fineTypeId;
    dateFrom;
    dateTo;
    /** Substring match on the fine's own createdBy User.name. */
    createdByName;
    /** Substring match on the reader's own User.name or LibraryStudent.code. */
    studentSearch;
    amountMin;
    amountMax;
}
exports.ListFinesDto = ListFinesDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ListFinesDto.prototype, "studentId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value)),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsIn)(FINE_STATUSES, { each: true }),
    __metadata("design:type", Array)
], ListFinesDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ListFinesDto.prototype, "fineTypeId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], ListFinesDto.prototype, "dateFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], ListFinesDto.prototype, "dateTo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ListFinesDto.prototype, "createdByName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ListFinesDto.prototype, "studentSearch", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], ListFinesDto.prototype, "amountMin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], ListFinesDto.prototype, "amountMax", void 0);
