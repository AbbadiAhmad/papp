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
exports.ResponsesController = void 0;
const common_1 = require("@nestjs/common");
const platform_1 = require("./platform");
const reports_service_1 = require("./reports.service");
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fetchResponseState = (prisma, req) => prisma.surveyResponse.findUnique({ where: { id: req.params.responseId }, include: { answers: true } });
/**
 * The admin surface over SUBMITTED responses (list/view/delete) plus the
 * report/export endpoints — deliberately a separate controller from
 * `SurveysController` (which only manages the survey DEFINITION) even
 * though both live under `api/survey/surveys/:id/...`; Nest happily
 * resolves routes from multiple controllers sharing a path prefix, same as
 * how library_catalog keeps a book's own CRUD and its copies handling in
 * one controller only because that split wouldn't have been as clean —
 * here it is.
 *
 * `export`/`report/*` are declared BEFORE `:responseId` (Nest/Express
 * matches routes in declaration order) so `GET .../responses/export` can
 * never be swallowed by `GET .../responses/:responseId` — same ordering
 * rule BooksController's own `export` route follows.
 */
let ResponsesController = class ResponsesController {
    reports;
    constructor(reports) {
        this.reports = reports;
    }
    async export(id, res) {
        const buffer = await this.reports.exportResponsesWorkbook(id);
        res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="survey-responses-export.xlsx"' });
        res.send(buffer);
    }
    async summary(id) {
        return this.reports.getSummary(id);
    }
    async dataset(id) {
        return this.reports.getDataset(id);
    }
    async list(id) {
        return this.reports.listResponses(id);
    }
    async findOne(id, responseId) {
        return this.reports.getResponse(id, responseId);
    }
    async remove(id, responseId) {
        await this.reports.removeResponse(id, responseId);
    }
};
exports.ResponsesController = ResponsesController;
__decorate([
    (0, common_1.Get)(':id/responses/export'),
    (0, platform_1.RequirePermission)('survey.responses.export'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ResponsesController.prototype, "export", null);
__decorate([
    (0, common_1.Get)(':id/report/summary'),
    (0, platform_1.RequirePermission)('survey.responses.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ResponsesController.prototype, "summary", null);
__decorate([
    (0, common_1.Get)(':id/report/dataset'),
    (0, platform_1.RequirePermission)('survey.responses.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ResponsesController.prototype, "dataset", null);
__decorate([
    (0, common_1.Get)(':id/responses'),
    (0, platform_1.RequirePermission)('survey.responses.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ResponsesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id/responses/:responseId'),
    (0, platform_1.RequirePermission)('survey.responses.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('responseId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ResponsesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Delete)(':id/responses/:responseId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('survey.responses.delete'),
    (0, platform_1.Audit)({ category: 'survey.responses', entityType: 'SurveyResponse', action: 'delete', entityIdParam: 'responseId', fetchState: fetchResponseState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('responseId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ResponsesController.prototype, "remove", null);
exports.ResponsesController = ResponsesController = __decorate([
    (0, common_1.Controller)('api/survey/surveys'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [reports_service_1.ReportsService])
], ResponsesController);
