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
exports.DashboardController = void 0;
const common_1 = require("@nestjs/common");
const groups_service_1 = require("./groups.service");
const platform_1 = require("./platform");
const stage_completions_service_1 = require("./stage-completions.service");
/**
 * "The dashboard shows the groups and stages statistics" — real aggregate
 * counts from GroupsService/StageCompletionsService, no mock data (same
 * composition pattern as library_circulation's own DashboardController).
 * `episodeId` omitted -> current episode (READING_CLUB-D12), so a permitted
 * user can browse a past episode's dashboard read-only.
 *
 * `pendingRewards` (item C, the full list with reader identity) is folded
 * into this same endpoint rather than a separate one — one round trip, the
 * list is realistically small (school reading club, no pagination) — gated
 * by the SAME `reading_club.dashboard.view` permission as the rest of this
 * endpoint (READING_CLUB-D14: `StageCompletionsController.pendingRewards`
 * itself uses the broader `.memberships.view` for its per-reader variant,
 * reasoning "anyone who can see a reader's profile can see their own
 * pending rewards"; here the aggregate cross-reader list is squarely
 * dashboard content, so it stays under `.dashboard.view` rather than
 * introducing a permission split within one response).
 */
let DashboardController = class DashboardController {
    groups;
    stageCompletions;
    constructor(groups, stageCompletions) {
        this.groups = groups;
        this.stageCompletions = stageCompletions;
    }
    async getStats(episodeId) {
        const [groupStats, pendingRewardsCount, pendingRewards] = await Promise.all([
            this.groups.getDashboardStats(episodeId),
            this.stageCompletions.getPendingRewardsCount(episodeId),
            this.stageCompletions.listAllPendingRewards(episodeId),
        ]);
        return { ...groupStats, pendingRewardsCount, pendingRewards };
    }
};
exports.DashboardController = DashboardController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('reading_club.dashboard.view'),
    __param(0, (0, common_1.Query)('episodeId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DashboardController.prototype, "getStats", null);
exports.DashboardController = DashboardController = __decorate([
    (0, common_1.Controller)('api/reading-club/dashboard'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [groups_service_1.GroupsService,
        stage_completions_service_1.StageCompletionsService])
], DashboardController);
