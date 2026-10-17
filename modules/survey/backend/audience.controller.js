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
exports.AudienceController = void 0;
const common_1 = require("@nestjs/common");
const audience_service_1 = require("./audience.service");
const add_collaborator_dto_1 = require("./dto/add-collaborator.dto");
const invite_dto_1 = require("./dto/invite.dto");
const platform_1 = require("./platform");
const survey_access_1 = require("./survey-access");
/**
 * Who may respond and the invitations (survey ext. H, SURVEY-D22). Editing rights on the survey are enough
 * (permission `survey.surveys.update`, or being a co-owner). The mutating calls return small summaries — never the
 * whole list of email addresses — so the audit trail does not copy the audience each time; the page re-reads
 * `GET :id/audience` afterwards.
 */
let AudienceController = class AudienceController {
    audience;
    constructor(audience) {
        this.audience = audience;
    }
    async get(id) {
        return this.audience.getAudience(id);
    }
    async addUser(id, dto, user) {
        return this.audience.addAllowedUser(id, dto.email, user.userId);
    }
    async removeUser(id, userId) {
        return this.audience.removeAllowedUser(id, userId);
    }
    async invite(id, dto, user) {
        return this.audience.invite(id, dto.emails, user.userId);
    }
    async remind(id) {
        return this.audience.remind(id);
    }
    async removeInvitation(id, invitationId) {
        return this.audience.removeInvitation(id, invitationId);
    }
};
exports.AudienceController = AudienceController;
__decorate([
    (0, common_1.Get)('audience'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.update', { collaborator: true }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AudienceController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('audience/users'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, survey_access_1.SurveyAccess)('survey.surveys.update', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveyAllowedUser', action: 'add_allowed_user' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, add_collaborator_dto_1.AddCollaboratorDto, Object]),
    __metadata("design:returntype", Promise)
], AudienceController.prototype, "addUser", null);
__decorate([
    (0, common_1.Delete)('audience/users/:userId'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.update', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveyAllowedUser', action: 'remove_allowed_user' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('userId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AudienceController.prototype, "removeUser", null);
__decorate([
    (0, common_1.Post)('invitations'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, survey_access_1.SurveyAccess)('survey.surveys.update', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveyInvitation', action: 'invite' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, invite_dto_1.InviteDto, Object]),
    __metadata("design:returntype", Promise)
], AudienceController.prototype, "invite", null);
__decorate([
    (0, common_1.Post)('invitations/remind'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, survey_access_1.SurveyAccess)('survey.surveys.update', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveyInvitation', action: 'remind' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AudienceController.prototype, "remind", null);
__decorate([
    (0, common_1.Delete)('invitations/:invitationId'),
    (0, survey_access_1.SurveyAccess)('survey.surveys.update', { collaborator: true }),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveyInvitation', action: 'remove_invitation' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('invitationId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AudienceController.prototype, "removeInvitation", null);
exports.AudienceController = AudienceController = __decorate([
    (0, common_1.Controller)('api/survey/surveys/:id'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard, survey_access_1.SurveyAccessGuard),
    __metadata("design:paramtypes", [audience_service_1.AudienceService])
], AudienceController);
