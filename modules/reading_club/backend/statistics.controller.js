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
exports.StatisticsController = void 0;
const common_1 = require("@nestjs/common");
const statistics_query_dto_1 = require("./dto/statistics-query.dto");
const platform_1 = require("./platform");
const statistics_service_1 = require("./statistics.service");
/**
 * Club + library statistics (read-only aggregate; includes reader names in the
 * top lists, hence its own permission rather than reusing the dashboard's).
 */
let StatisticsController = class StatisticsController {
    statistics;
    constructor(statistics) {
        this.statistics = statistics;
    }
    async get(query) {
        return this.statistics.getStatistics(query);
    }
};
exports.StatisticsController = StatisticsController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('reading_club.statistics.view'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [statistics_query_dto_1.StatisticsQueryDto]),
    __metadata("design:returntype", Promise)
], StatisticsController.prototype, "get", null);
exports.StatisticsController = StatisticsController = __decorate([
    (0, common_1.Controller)('api/reading-club/statistics'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [statistics_service_1.StatisticsService])
], StatisticsController);
