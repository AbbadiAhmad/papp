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
exports.ReturnDto = exports.ReturnStatus = void 0;
const class_validator_1 = require("class-validator");
var ReturnStatus;
(function (ReturnStatus) {
    ReturnStatus["returned"] = "returned";
    ReturnStatus["damaged"] = "damaged";
    ReturnStatus["lost"] = "lost";
    ReturnStatus["other"] = "other";
})(ReturnStatus || (exports.ReturnStatus = ReturnStatus = {}));
class ReturnDto {
    borrowingId;
    returnStatus;
    returnNotes;
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
