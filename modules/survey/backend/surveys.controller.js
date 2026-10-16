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
exports.SurveysController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const add_collaborator_dto_1 = require("./dto/add-collaborator.dto");
const create_survey_dto_1 = require("./dto/create-survey.dto");
const duplicate_survey_dto_1 = require("./dto/duplicate-survey.dto");
const survey_structure_dto_1 = require("./dto/survey-structure.dto");
const update_survey_dto_1 = require("./dto/update-survey.dto");
const platform_1 = require("./platform");
const survey_access_1 = require("./survey-access");
const survey_transfer_service_1 = require("./survey-transfer.service");
const surveys_service_1 = require("./surveys.service");
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const fetchSurveyState = (prisma, req) => prisma.surveySurvey.findUnique({ where: { id: req.params.id } });
/**
 * The builder/admin surface (docs/DECISIONS.md — plain RBAC, no per-owner
 * scoping: anyone holding the relevant `survey.*` permission manages EVERY
 * survey, exactly like library_catalog's BooksController manages every
 * book). `JwtAuthGuard`/`PermissionGuard`/`AuditInterceptor` are global —
 * only `MustChangePasswordGuard` needs applying locally, same as every
 * other module controller.
 */
let SurveysController = class SurveysController {
    surveys;
    transfer;
    access;
    constructor(surveys, transfer, access) {
        this.surveys = surveys;
        this.transfer = transfer;
        this.access = access;
    }
    async list(archived, user) {
        const [rows, perms, coOwned] = await Promise.all([this.surveys.list(archived === 'true'), this.access.permissionsOf(user.userId), this.access.coOwnedIds(user.userId)]);
        return rows.map((row) => ({ ...row, access: this.access.capabilities(perms, user.userId, row, coOwned.has(row.id)) }));
    }
    /** Declared before every `:id` route so `import` is never read as a survey id. */
    async importPackage(file, includeResponses, user) {
        if (!file)
            throw new common_1.BadRequestException('No file uploaded (expected multipart field "file")');
        return this.transfer.importZip(file.buffer, user.userId, includeResponses === 'true');
    }
    async create(dto, user) {
        return this.surveys.create(dto, user.userId);
    }
    async findById(id, user) {
        const survey = await this.surveys.findById(id);
        const [perms, coOwner] = await Promise.all([this.access.permissionsOf(user.userId), this.access.isCoOwner(id, user.userId)]);
        return { ...survey, access: this.access.capabilities(perms, user.userId, survey, coOwner) };
    }
    // --- Co-owners (SURVEY-D21) -------------------------------------------
    async listCoOwners(id) {
        return this.access.listCoOwners(id);
    }
    async addCoOwner(id, dto, user) {
        return this.access.addCoOwner(id, dto.email, user.userId);
    }
    async removeCoOwner(id, userId) {
        return this.access.removeCoOwner(id, userId);
    }
    async update(id, dto) {
        return this.surveys.update(id, dto);
    }
    async remove(id) {
        await this.surveys.remove(id);
    }
    async publish(id) {
        return this.surveys.publish(id);
    }
    async close(id) {
        return this.surveys.close(id);
    }
    async reopen(id) {
        return this.surveys.reopen(id);
    }
    async archive(id) {
        return this.surveys.archive(id);
    }
    async unarchive(id) {
        return this.surveys.unarchive(id);
    }
    async duplicate(id, dto, user) {
        return this.transfer.duplicate(id, user.userId, dto.title);
    }
    /** Survey definition only (sections, questions, rules, settings). */
    async exportDefinition(id, res) {
        await this.sendZip(res, id, false);
    }
    /** Definition plus every response — gated by the existing responses-export permission. */
    async exportWithResponses(id, res) {
        await this.sendZip(res, id, true);
    }
    async sendZip(res, id, includeResponses) {
        const { buffer, filename } = await this.transfer.exportZip(id, includeResponses);
        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="survey.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        });
        res.send(buffer);
    }
    async replaceStructure(id, dto) {
        return this.surveys.replaceStructure(id, dto);
    }
};
exports.SurveysController = SurveysController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('survey.surveys.view'),
    __param(0, (0, common_1.Query)('archived')),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('import'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, platform_1.RequirePermission)('survey.surveys.import'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'import' }),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: MAX_IMPORT_BYTES } })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)('includeResponses')),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "importPackage", null);
__decorate([
    (0, common_1.Post)(),
    (0, platform_1.RequirePermission)('survey.surveys.create'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_survey_dto_1.CreateSurveyDto, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.RequirePermission)('survey.surveys.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "findById", null);
__decorate([
    (0, common_1.Get)(':id/collaborators'),
    (0, platform_1.RequirePermission)('survey.surveys.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "listCoOwners", null);
__decorate([
    (0, common_1.Post)(':id/collaborators'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, survey_access_1.SurveyAccess)('survey.surveys.share', { owner: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveyCollaborator', action: 'add_co_owner' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, add_collaborator_dto_1.AddCollaboratorDto, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "addCoOwner", null);
__decorate([
    (0, common_1.Delete)(':id/collaborators/:userId'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.share', { owner: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveyCollaborator', action: 'remove_co_owner' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('userId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "removeCoOwner", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.update', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'update', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_survey_dto_1.UpdateSurveyDto]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('survey.surveys.delete'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'delete', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/publish'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.publish', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'publish', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "publish", null);
__decorate([
    (0, common_1.Post)(':id/close'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.publish', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'close', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "close", null);
__decorate([
    (0, common_1.Post)(':id/reopen'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.publish', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'reopen', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "reopen", null);
__decorate([
    (0, common_1.Post)(':id/archive'),
    (0, platform_1.RequirePermission)('survey.surveys.archive'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'archive', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "archive", null);
__decorate([
    (0, common_1.Post)(':id/unarchive'),
    (0, platform_1.RequirePermission)('survey.surveys.archive'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'unarchive', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "unarchive", null);
__decorate([
    (0, common_1.Post)(':id/duplicate'),
    (0, platform_1.RequirePermission)('survey.surveys.create'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'duplicate' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, duplicate_survey_dto_1.DuplicateSurveyDto, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "duplicate", null);
__decorate([
    (0, common_1.Get)(':id/export'),
    (0, platform_1.RequirePermission)('survey.surveys.export'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "exportDefinition", null);
__decorate([
    (0, common_1.Get)(':id/export-with-responses'),
    (0, survey_access_1.SurveyAccess)('survey.responses.export', { collaborator: true }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "exportWithResponses", null);
__decorate([
    (0, common_1.Put)(':id/structure'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.update', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'update_structure' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, survey_structure_dto_1.SurveyStructureDto]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "replaceStructure", null);
exports.SurveysController = SurveysController = __decorate([
    (0, common_1.Controller)('api/survey/surveys'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard, survey_access_1.SurveyAccessGuard),
    __metadata("design:paramtypes", [surveys_service_1.SurveysService,
        survey_transfer_service_1.SurveyTransferService,
        survey_access_1.SurveyAccessService])
], SurveysController);
