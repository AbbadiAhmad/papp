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
exports.PublicSurveyController = void 0;
const common_1 = require("@nestjs/common");
// The REAL core guard, imported from apps/api's BUILT output — see
// platform.ts's docblock / modules/library_catalog/backend/public.controller.ts
// for exactly why (D57's exception category).
// eslint-disable-next-line import/no-unresolved
const public_throttler_guard_1 = require("../../../apps/api/dist/common/guards/public-throttler.guard");
const submit_response_dto_1 = require("./dto/submit-response.dto");
const platform_1 = require("./platform");
const request_meta_1 = require("./request-meta");
const responses_service_1 = require("./responses.service");
/**
 * The PUBLIC/ANONYMOUS half of the fill/submit split — reachable with no
 * `Authorization` header at all (MODULE_SPEC.md §7, mirrors
 * library_catalog's own PublicBooksController). `ResponsesService` itself
 * rejects with a 403 if the survey's own `requiresLogin` is true; the
 * frontend's single `/survey/:id` route turns that into a "please log in"
 * prompt rather than a raw error.
 *
 * `PublicThrottlerGuard` is applied to the WRITES only (submit/edit) —
 * MODULE_SPEC.md §7.3's public-write-abuse-mitigation rule; the read is
 * left unthrottled like library_catalog's own public GET.
 */
let PublicSurveyController = class PublicSurveyController {
    responses;
    constructor(responses) {
        this.responses = responses;
    }
    async getForFilling(id) {
        return this.responses.getForFilling(id, null);
    }
    async submit(id, dto, req) {
        return this.responses.submitPublic(id, dto.answers, (0, request_meta_1.extractRequestMeta)(req));
    }
    /**
     * `editToken` travels as a query param, not a route segment — no
     * responseId is needed at all (ResponsesService.editPublic looks the
     * response up by the token's hash alone; see its own docblock).
     */
    async edit(id, editToken, dto, req) {
        return this.responses.editPublic(id, editToken, dto.answers, (0, request_meta_1.extractRequestMeta)(req));
    }
};
exports.PublicSurveyController = PublicSurveyController;
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.Public)(),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicSurveyController.prototype, "getForFilling", null);
__decorate([
    (0, common_1.Post)(':id'),
    (0, platform_1.Public)(),
    (0, common_1.UseGuards)(public_throttler_guard_1.PublicThrottlerGuard),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, submit_response_dto_1.SubmitResponseDto, Object]),
    __metadata("design:returntype", Promise)
], PublicSurveyController.prototype, "submit", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, platform_1.Public)(),
    (0, common_1.UseGuards)(public_throttler_guard_1.PublicThrottlerGuard),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Query)('editToken')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, submit_response_dto_1.SubmitResponseDto, Object]),
    __metadata("design:returntype", Promise)
], PublicSurveyController.prototype, "edit", null);
exports.PublicSurveyController = PublicSurveyController = __decorate([
    (0, common_1.Controller)('api/survey/public'),
    __metadata("design:paramtypes", [responses_service_1.ResponsesService])
], PublicSurveyController);
