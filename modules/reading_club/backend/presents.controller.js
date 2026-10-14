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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PresentsController = void 0;
const common_1 = require("@nestjs/common");
const give_present_dto_1 = require("./dto/give-present.dto");
const presents_service_1 = require("./presents.service");
const platform_1 = require("./platform");
let PresentsController = class PresentsController {
    presents;
    constructor(presents) {
        this.presents = presents;
    }
    async give(studentId, dto, user) {
        return this.presents.give(studentId, dto, user.userId);
    }
    async update(presentId, dto) {
        return this.presents.update(presentId, dto);
    }
    async remove(presentId) {
        return this.presents.remove(presentId);
    }
};
exports.PresentsController = PresentsController;
__decorate([
    (0, common_1.Post)('readers/:studentId/presents'),
    (0, platform_1.RequirePermission)('reading_club.presents.give'),
    (0, platform_1.Audit)({ category: 'reading_club.presents', entityType: 'ReadingClubPresent', action: 'give' }),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, give_present_dto_1.GivePresentDto, Object]),
    __metadata("design:returntype", Promise)
], PresentsController.prototype, "give", null);
__decorate([
    (0, common_1.Patch)('presents/:presentId'),
    (0, platform_1.RequirePermission)('reading_club.presents.manage'),
    (0, platform_1.Audit)({ category: 'reading_club.presents', entityType: 'ReadingClubPresent', action: 'update' }),
    __param(0, (0, common_1.Param)('presentId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, give_present_dto_1.GivePresentDto]),
    __metadata("design:returntype", Promise)
], PresentsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)('presents/:presentId'),
    (0, platform_1.RequirePermission)('reading_club.presents.manage'),
    (0, platform_1.Audit)({ category: 'reading_club.presents', entityType: 'ReadingClubPresent', action: 'delete' }),
    __param(0, (0, common_1.Param)('presentId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PresentsController.prototype, "remove", null);
exports.PresentsController = PresentsController = __decorate([
    (0, common_1.Controller)('api/reading-club'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [presents_service_1.PresentsService])
], PresentsController);
