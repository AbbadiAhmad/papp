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
exports.FillController = void 0;
const common_1 = require("@nestjs/common");
const submit_response_dto_1 = require("./dto/submit-response.dto");
const platform_1 = require("./platform");
const request_meta_1 = require("./request-meta");
const responses_service_1 = require("./responses.service");
/**
 * The AUTHENTICATED half of the fill/submit split (this module's
 * implementation-plan §"Taking a survey — two endpoints, not one"):
 * deliberately carries NO `@RequirePermission(...)` at all. `PermissionGuard`
 * (global) already treats an undecorated handler as "any authenticated user,
 * any role" — the exact "being logged in is always a safe superset of a
 * public survey" rule the plan calls for, reusing an existing platform
 * mechanism rather than inventing a new one.
 *
 * Used whenever the visitor already has a session, REGARDLESS of the
 * survey's own `requiresLogin` value. A `requiresLogin` survey can ONLY be
 * filled through this controller; `PublicSurveyController` rejects it.
 */
let FillController = class FillController {
    responses;
    constructor(responses) {
        this.responses = responses;
    }
    async getForFilling(id, user) {
        return this.responses.getForFilling(id, user.userId);
    }
    async submit(id, dto, user, req) {
        // No @Audit here — ResponsesService writes its own audit_log row
        // directly (see responses.service.ts's writeResponse docblock).
        return this.responses.submitAuthenticated(id, user.userId, user.sessionId, dto.answers, (0, request_meta_1.extractRequestMeta)(req));
    }
};
exports.FillController = FillController;
__decorate([
    (0, common_1.Get)(':id/fill'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FillController.prototype, "getForFilling", null);
__decorate([
    (0, common_1.Post)(':id/fill'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, submit_response_dto_1.SubmitResponseDto, Object, Object]),
    __metadata("design:returntype", Promise)
], FillController.prototype, "submit", null);
exports.FillController = FillController = __decorate([
    (0, common_1.Controller)('api/survey'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [responses_service_1.ResponsesService])
], FillController);
