"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadingClubModule = void 0;
const common_1 = require("@nestjs/common");
// The REAL core module/service, imported from apps/api's BUILT output
// (D57/D64 exception category) — the ONE file in this module allowed to
// import from `apps/api/dist/...` for notifications; see
// `notifications-sender.ts`'s own docblock for why `stage-completions.service.ts`
// itself must NOT (breaks its Jest unit tests, root D68 item 3).
// eslint-disable-next-line import/no-unresolved
const notifications_module_1 = require("../../../apps/api/dist/core/notifications/notifications.module");
// eslint-disable-next-line import/no-unresolved
const notifications_service_1 = require("../../../apps/api/dist/core/notifications/notifications.service");
const confirm_reward_controller_1 = require("./confirm-reward.controller");
const dashboard_controller_1 = require("./dashboard.controller");
const groups_controller_1 = require("./groups.controller");
const groups_service_1 = require("./groups.service");
const memberships_controller_1 = require("./memberships.controller");
const memberships_service_1 = require("./memberships.service");
const notifications_sender_1 = require("./notifications-sender");
const stage_completions_controller_1 = require("./stage-completions.controller");
const stage_completions_service_1 = require("./stage-completions.service");
/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`reading-club.module.js`, via this module's own `tsconfig.json`)
 * — same pattern as every other module, see
 * `modules/template/backend/template.module.ts`'s own docblock.
 */
let ReadingClubModule = class ReadingClubModule {
};
exports.ReadingClubModule = ReadingClubModule;
exports.ReadingClubModule = ReadingClubModule = __decorate([
    (0, common_1.Module)({
        imports: [notifications_module_1.NotificationsModule],
        controllers: [groups_controller_1.GroupsController, memberships_controller_1.MembershipsController, stage_completions_controller_1.StageCompletionsController, confirm_reward_controller_1.ConfirmRewardController, dashboard_controller_1.DashboardController],
        providers: [
            groups_service_1.GroupsService,
            memberships_service_1.MembershipsService,
            stage_completions_service_1.StageCompletionsService,
            { provide: notifications_sender_1.NOTIFICATIONS_SENDER, useExisting: notifications_service_1.NotificationsService },
        ],
    })
], ReadingClubModule);
