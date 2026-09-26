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
exports.EpisodesController = void 0;
const common_1 = require("@nestjs/common");
const create_episode_dto_1 = require("./dto/create-episode.dto");
const episodes_service_1 = require("./episodes.service");
const platform_1 = require("./platform");
/**
 * Episodes (seasons/years). Read access reuses `reading_club.groups.view`
 * (READING_CLUB-D12 — everyone who can browse groups needs to know which
 * episode they belong to and be able to switch to a past one); the write
 * endpoint (`POST /episodes`) is gated by the stronger, dedicated
 * `reading_club.episodes.manage`.
 */
let EpisodesController = class EpisodesController {
    episodes;
    constructor(episodes) {
        this.episodes = episodes;
    }
    async list() {
        return this.episodes.listEpisodes();
    }
    async current() {
        return this.episodes.getCurrentEpisode();
    }
    async findById(id) {
        return this.episodes.getEpisodeOrThrow(id);
    }
    async create(dto, user) {
        return this.episodes.createEpisode(dto, user.userId);
    }
};
exports.EpisodesController = EpisodesController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('reading_club.groups.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], EpisodesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('current'),
    (0, platform_1.RequirePermission)('reading_club.groups.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], EpisodesController.prototype, "current", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.RequirePermission)('reading_club.groups.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], EpisodesController.prototype, "findById", null);
__decorate([
    (0, common_1.Post)(),
    (0, platform_1.RequirePermission)('reading_club.episodes.manage'),
    (0, platform_1.Audit)({ category: 'reading_club.episodes', entityType: 'ReadingClubEpisode', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_episode_dto_1.CreateEpisodeDto, Object]),
    __metadata("design:returntype", Promise)
], EpisodesController.prototype, "create", null);
exports.EpisodesController = EpisodesController = __decorate([
    (0, common_1.Controller)('api/reading-club/episodes'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [episodes_service_1.EpisodesService])
], EpisodesController);
