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
exports.GroupsController = void 0;
const common_1 = require("@nestjs/common");
const create_group_dto_1 = require("./dto/create-group.dto");
const create_stage_dto_1 = require("./dto/create-stage.dto");
const update_group_dto_1 = require("./dto/update-group.dto");
const update_stage_dto_1 = require("./dto/update-stage.dto");
const groups_service_1 = require("./groups.service");
const platform_1 = require("./platform");
const fetchGroupState = (prisma, req) => prisma.readingClubGroup.findUnique({ where: { id: req.params.id } });
const fetchStageState = (prisma, req) => prisma.readingClubStage.findUnique({ where: { id: req.params.stageId } });
/**
 * Groups + their ordered stages — "the librarian defines the groups, the
 * stages, the amount in every stage, the present after every stage, the
 * stage order" (see this module's own DOCUMENTATION.md "Settings" section
 * for why this is plain entity CRUD, not the manifest's `settings[]`
 * mechanism). `JwtAuthGuard`/`PermissionGuard` are global; only
 * `MustChangePasswordGuard` needs applying locally.
 */
let GroupsController = class GroupsController {
    groups;
    constructor(groups) {
        this.groups = groups;
    }
    async list() {
        return this.groups.listGroups();
    }
    async findById(id) {
        return this.groups.getGroup(id);
    }
    async create(dto, user) {
        return this.groups.createGroup(dto, user.userId);
    }
    async update(id, dto) {
        return this.groups.updateGroup(id, dto);
    }
    async remove(id) {
        await this.groups.removeGroup(id);
    }
    // --- Stages (nested under their group) ---------------------------------
    async listStages(groupId) {
        return this.groups.listStages(groupId);
    }
    async createStage(groupId, dto) {
        return this.groups.createStage(groupId, dto);
    }
    async updateStage(stageId, dto) {
        return this.groups.updateStage(stageId, dto);
    }
    async removeStage(stageId) {
        await this.groups.removeStage(stageId);
    }
};
exports.GroupsController = GroupsController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('reading_club.groups.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.RequirePermission)('reading_club.groups.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "findById", null);
__decorate([
    (0, common_1.Post)(),
    (0, platform_1.RequirePermission)('reading_club.groups.create'),
    (0, platform_1.Audit)({ category: 'reading_club.groups', entityType: 'ReadingClubGroup', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_group_dto_1.CreateGroupDto, Object]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, platform_1.RequirePermission)('reading_club.groups.update'),
    (0, platform_1.Audit)({ category: 'reading_club.groups', entityType: 'ReadingClubGroup', action: 'update', fetchState: fetchGroupState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_group_dto_1.UpdateGroupDto]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('reading_club.groups.delete'),
    (0, platform_1.Audit)({ category: 'reading_club.groups', entityType: 'ReadingClubGroup', action: 'delete', fetchState: fetchGroupState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)(':groupId/stages'),
    (0, platform_1.RequirePermission)('reading_club.groups.view'),
    __param(0, (0, common_1.Param)('groupId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "listStages", null);
__decorate([
    (0, common_1.Post)(':groupId/stages'),
    (0, platform_1.RequirePermission)('reading_club.groups.update'),
    (0, platform_1.Audit)({ category: 'reading_club.groups', entityType: 'ReadingClubStage', action: 'create' }),
    __param(0, (0, common_1.Param)('groupId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_stage_dto_1.CreateStageDto]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "createStage", null);
__decorate([
    (0, common_1.Patch)('stages/:stageId'),
    (0, platform_1.RequirePermission)('reading_club.groups.update'),
    (0, platform_1.Audit)({ category: 'reading_club.groups', entityType: 'ReadingClubStage', action: 'update', fetchState: fetchStageState }),
    __param(0, (0, common_1.Param)('stageId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_stage_dto_1.UpdateStageDto]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "updateStage", null);
__decorate([
    (0, common_1.Delete)('stages/:stageId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('reading_club.groups.delete'),
    (0, platform_1.Audit)({ category: 'reading_club.groups', entityType: 'ReadingClubStage', action: 'delete', fetchState: fetchStageState }),
    __param(0, (0, common_1.Param)('stageId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "removeStage", null);
exports.GroupsController = GroupsController = __decorate([
    (0, common_1.Controller)('api/reading-club/groups'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [groups_service_1.GroupsService])
], GroupsController);
