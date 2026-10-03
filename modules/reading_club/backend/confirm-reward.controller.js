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
exports.ConfirmRewardController = void 0;
const common_1 = require("@nestjs/common");
const stage_completions_service_1 = require("./stage-completions.service");
const platform_1 = require("./platform");
let ConfirmRewardController = class ConfirmRewardController {
    stageCompletions;
    constructor(stageCompletions) {
        this.stageCompletions = stageCompletions;
    }
    /** Called from either this module's own reader page or library_circulation's scan-page hook — same endpoint either way. */
    async confirmReward(completionId, user) {
        return this.stageCompletions.confirmReward(completionId, user.userId);
    }
};
exports.ConfirmRewardController = ConfirmRewardController;
__decorate([
    (0, common_1.Post)(':completionId/confirm-reward'),
    (0, platform_1.RequirePermission)('reading_club.stage_completions.confirm_reward'),
    (0, platform_1.Audit)({ category: 'reading_club.stage_completions', entityType: 'ReadingClubStageCompletion', action: 'confirm_reward' }),
    __param(0, (0, common_1.Param)('completionId', new common_1.ParseUUIDPipe())),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ConfirmRewardController.prototype, "confirmReward", null);
exports.ConfirmRewardController = ConfirmRewardController = __decorate([
    (0, common_1.Controller)('api/reading-club/stage-completions'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [stage_completions_service_1.StageCompletionsService])
], ConfirmRewardController);
