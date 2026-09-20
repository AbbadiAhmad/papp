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
exports.ReturnDto = exports.ReturnFineDto = exports.ReturnStatus = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
var ReturnStatus;
(function (ReturnStatus) {
    ReturnStatus["returned"] = "returned";
    ReturnStatus["damaged"] = "damaged";
    ReturnStatus["lost"] = "lost";
    ReturnStatus["other"] = "other";
})(ReturnStatus || (exports.ReturnStatus = ReturnStatus = {}));
/** Return dialog's extendable "add fine" checkbox — created in the SAME request/transaction as the return, not a separate follow-up step. */
class ReturnFineDto {
    fineTypeId;
    amount;
    notes;
}
exports.ReturnFineDto = ReturnFineDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ReturnFineDto.prototype, "fineTypeId", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0.01),
    __metadata("design:type", Number)
], ReturnFineDto.prototype, "amount", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReturnFineDto.prototype, "notes", void 0);
class ReturnDto {
    borrowingId;
    returnStatus;
    returnNotes;
    /** Backdating support — defaults to "now" server-side when omitted. */
    returnedAt;
    fine;
}
exports.ReturnDto = ReturnDto;
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ReturnDto.prototype, "borrowingId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(ReturnStatus),
    __metadata("design:type", String)
], ReturnDto.prototype, "returnStatus", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReturnDto.prototype, "returnNotes", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], ReturnDto.prototype, "returnedAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => ReturnFineDto),
    (0, class_validator_1.ValidateNested)(),
    __metadata("design:type", ReturnFineDto)
], ReturnDto.prototype, "fine", void 0);
