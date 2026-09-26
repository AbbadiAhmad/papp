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
const create_survey_dto_1 = require("./dto/create-survey.dto");
const survey_structure_dto_1 = require("./dto/survey-structure.dto");
const update_survey_dto_1 = require("./dto/update-survey.dto");
const platform_1 = require("./platform");
const surveys_service_1 = require("./surveys.service");
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
    constructor(surveys) {
        this.surveys = surveys;
    }
    async list() {
        return this.surveys.list();
    }
    async create(dto, user) {
        return this.surveys.create(dto, user.userId);
    }
    async findById(id) {
        return this.surveys.findById(id);
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
    async replaceStructure(id, dto) {
        return this.surveys.replaceStructure(id, dto);
    }
};
exports.SurveysController = SurveysController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('survey.surveys.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "list", null);
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
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "findById", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, platform_1.RequirePermission)('survey.surveys.update'),
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
    (0, platform_1.RequirePermission)('survey.surveys.publish'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'publish', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "publish", null);
__decorate([
    (0, common_1.Post)(':id/close'),
    (0, platform_1.RequirePermission)('survey.surveys.publish'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'close', fetchState: fetchSurveyState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "close", null);
__decorate([
    (0, common_1.Put)(':id/structure'),
    (0, platform_1.RequirePermission)('survey.surveys.update'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'update_structure' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, survey_structure_dto_1.SurveyStructureDto]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "replaceStructure", null);
exports.SurveysController = SurveysController = __decorate([
    (0, common_1.Controller)('api/survey/surveys'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [surveys_service_1.SurveysService])
], SurveysController);
