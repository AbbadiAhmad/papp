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
// eslint-disable-next-line import/no-unresolved
const permissions_service_1 = require("../../../apps/api/dist/core/permissions/permissions.service");
const club_events_1 = require("./club-events");
const club_events_service_1 = require("./club-events.service");
const confirm_reward_controller_1 = require("./confirm-reward.controller");
const dashboard_controller_1 = require("./dashboard.controller");
const event_subscriptions_controller_1 = require("./event-subscriptions.controller");
const episodes_controller_1 = require("./episodes.controller");
const episodes_service_1 = require("./episodes.service");
const groups_controller_1 = require("./groups.controller");
const groups_service_1 = require("./groups.service");
const memberships_controller_1 = require("./memberships.controller");
const memberships_service_1 = require("./memberships.service");
const notifications_sender_1 = require("./notifications-sender");
const permission_checker_1 = require("./permission-checker");
const presents_controller_1 = require("./presents.controller");
const presents_service_1 = require("./presents.service");
const stage_book_entries_controller_1 = require("./stage-book-entries.controller");
const stage_book_entries_service_1 = require("./stage-book-entries.service");
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
        controllers: [
            episodes_controller_1.EpisodesController,
            groups_controller_1.GroupsController,
            memberships_controller_1.MembershipsController,
            stage_completions_controller_1.StageCompletionsController,
            stage_book_entries_controller_1.StageBookEntriesController,
            confirm_reward_controller_1.ConfirmRewardController,
            dashboard_controller_1.DashboardController,
            event_subscriptions_controller_1.EventSubscriptionsController,
            presents_controller_1.PresentsController,
        ],
        providers: [
            episodes_service_1.EpisodesService,
            groups_service_1.GroupsService,
            memberships_service_1.MembershipsService,
            stage_completions_service_1.StageCompletionsService,
            stage_book_entries_service_1.StageBookEntriesService,
            presents_service_1.PresentsService,
            club_events_service_1.ClubEventsService,
            { provide: notifications_sender_1.NOTIFICATIONS_SENDER, useExisting: notifications_service_1.NotificationsService },
            { provide: permission_checker_1.PERMISSION_CHECKER, useExisting: permissions_service_1.PermissionsService },
            { provide: club_events_1.CLUB_EVENT_PUBLISHER, useExisting: club_events_service_1.ClubEventsService },
        ],
    })
], ReadingClubModule);
