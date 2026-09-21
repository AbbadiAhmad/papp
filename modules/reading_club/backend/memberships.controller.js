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
exports.MembershipsController = void 0;
const common_1 = require("@nestjs/common");
const assign_membership_dto_1 = require("./dto/assign-membership.dto");
const move_stage_dto_1 = require("./dto/move-stage.dto");
const update_progress_dto_1 = require("./dto/update-progress.dto");
const memberships_service_1 = require("./memberships.service");
const platform_1 = require("./platform");
const fetchMembershipState = (prisma, req) => prisma.readingClubMembership.findUnique({ where: { studentId: req.params.studentId } });
let MembershipsController = class MembershipsController {
    memberships;
    constructor(memberships) {
        this.memberships = memberships;
    }
    async list(groupId, stageId, search) {
        return this.memberships.listReaders({ groupId, stageId, search });
    }
    async findById(studentId) {
        return this.memberships.getReaderDetail(studentId);
    }
    async assign(dto, user) {
        return this.memberships.assign(dto, user.userId);
    }
    async moveStage(studentId, dto) {
        return this.memberships.moveStage(studentId, dto);
    }
    async updateProgress(studentId, dto) {
        return this.memberships.updateManualProgress(studentId, dto);
    }
};
exports.MembershipsController = MembershipsController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('reading_club.memberships.view'),
    __param(0, (0, common_1.Query)('groupId')),
    __param(1, (0, common_1.Query)('stageId')),
    __param(2, (0, common_1.Query)('search')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], MembershipsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':studentId'),
    (0, platform_1.RequirePermission)('reading_club.memberships.view'),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MembershipsController.prototype, "findById", null);
__decorate([
    (0, common_1.Post)('assign'),
    (0, platform_1.RequirePermission)('reading_club.memberships.assign'),
    (0, platform_1.Audit)({ category: 'reading_club.memberships', entityType: 'ReadingClubMembership', action: 'assign' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assign_membership_dto_1.AssignMembershipDto, Object]),
    __metadata("design:returntype", Promise)
], MembershipsController.prototype, "assign", null);
__decorate([
    (0, common_1.Post)(':studentId/move-stage'),
    (0, platform_1.RequirePermission)('reading_club.memberships.assign'),
    (0, platform_1.Audit)({ category: 'reading_club.memberships', entityType: 'ReadingClubMembership', action: 'move_stage', fetchState: fetchMembershipState }),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, move_stage_dto_1.MoveStageDto]),
    __metadata("design:returntype", Promise)
], MembershipsController.prototype, "moveStage", null);
__decorate([
    (0, common_1.Put)(':studentId/progress'),
    (0, platform_1.RequirePermission)('reading_club.memberships.update_progress'),
    (0, platform_1.Audit)({ category: 'reading_club.memberships', entityType: 'ReadingClubMembership', action: 'update_progress', fetchState: fetchMembershipState }),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_progress_dto_1.UpdateProgressDto]),
    __metadata("design:returntype", Promise)
], MembershipsController.prototype, "updateProgress", null);
exports.MembershipsController = MembershipsController = __decorate([
    (0, common_1.Controller)('api/reading-club/readers'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [memberships_service_1.MembershipsService])
], MembershipsController);
