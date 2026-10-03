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
exports.StageCompletionsController = void 0;
const common_1 = require("@nestjs/common");
const stage_completions_service_1 = require("./stage-completions.service");
const platform_1 = require("./platform");
let StageCompletionsController = class StageCompletionsController {
    stageCompletions;
    constructor(stageCompletions) {
        this.stageCompletions = stageCompletions;
    }
    async markComplete(studentId, user) {
        return this.stageCompletions.markComplete(studentId, user.userId);
    }
    /**
     * Feeds BOTH this module's own reader detail page AND library_circulation's
     * scan-page hook (see that module's ScanPage.tsx — a direct, cross-module-
     * TS-import-free `apiClient` call; DECISIONS.md has the full reasoning).
     * Gated on `reading_club.memberships.view` (not the narrower
     * `.confirm_reward`) so any role that can already see a reader's profile
     * can also see this — confirming the reward itself still requires the
     * stronger permission, checked separately in `ConfirmRewardController`.
     */
    async pendingRewards(studentId) {
        return this.stageCompletions.listPendingRewards(studentId);
    }
};
exports.StageCompletionsController = StageCompletionsController;
__decorate([
    (0, common_1.Post)(':studentId/complete-stage'),
    (0, platform_1.RequirePermission)('reading_club.stage_completions.mark'),
    (0, platform_1.Audit)({ category: 'reading_club.stage_completions', entityType: 'ReadingClubStageCompletion', action: 'mark_complete' }),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], StageCompletionsController.prototype, "markComplete", null);
__decorate([
    (0, common_1.Get)(':studentId/pending-rewards'),
    (0, platform_1.RequirePermission)('reading_club.memberships.view'),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StageCompletionsController.prototype, "pendingRewards", null);
exports.StageCompletionsController = StageCompletionsController = __decorate([
    (0, common_1.Controller)('api/reading-club/readers'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [stage_completions_service_1.StageCompletionsService])
], StageCompletionsController);
