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
exports.EventSubscriptionsController = void 0;
const common_1 = require("@nestjs/common");
const club_events_service_1 = require("./club-events.service");
const set_subscriptions_dto_1 = require("./dto/set-subscriptions.dto");
const platform_1 = require("./platform");
const fetchMySubscriptions = async (prisma, req) => {
    const userId = req.user?.userId;
    if (!userId)
        return null;
    const rows = await prisma.readingClubEventSubscription.findMany({ where: { userId }, orderBy: { eventType: 'asc' } });
    return { eventTypes: rows.map((r) => r.eventType) };
};
/** A user manages only THEIR OWN subscriptions — there is no way to read or change another user's. */
let EventSubscriptionsController = class EventSubscriptionsController {
    events;
    constructor(events) {
        this.events = events;
    }
    async getMine(user) {
        return this.events.getMySubscriptions(user.userId);
    }
    async setMine(dto, user) {
        return this.events.setMySubscriptions(user.userId, dto.eventTypes);
    }
};
exports.EventSubscriptionsController = EventSubscriptionsController;
__decorate([
    (0, common_1.Get)('me'),
    (0, platform_1.RequirePermission)('reading_club.notifications.subscribe'),
    __param(0, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EventSubscriptionsController.prototype, "getMine", null);
__decorate([
    (0, common_1.Put)('me'),
    (0, platform_1.RequirePermission)('reading_club.notifications.subscribe'),
    (0, platform_1.Audit)({ category: 'reading_club.notifications', entityType: 'ReadingClubEventSubscription', action: 'update', fetchState: fetchMySubscriptions }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [set_subscriptions_dto_1.SetSubscriptionsDto, Object]),
    __metadata("design:returntype", Promise)
], EventSubscriptionsController.prototype, "setMine", null);
exports.EventSubscriptionsController = EventSubscriptionsController = __decorate([
    (0, common_1.Controller)('api/reading-club/event-subscriptions'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [club_events_service_1.ClubEventsService])
], EventSubscriptionsController);
