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
exports.SettingsController = void 0;
const common_1 = require("@nestjs/common");
const update_site_config_dto_1 = require("./dto/update-site-config.dto");
const platform_1 = require("./platform");
const settings_service_1 = require("./settings.service");
let SettingsController = class SettingsController {
    settings;
    constructor(settings) {
        this.settings = settings;
    }
    async getSiteConfig() {
        return this.settings.getSiteConfig();
    }
    async updateSiteConfig(dto) {
        return this.settings.updateSiteConfig(dto);
    }
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Get)('site-config'),
    (0, platform_1.RequirePermission)('website.settings.update'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getSiteConfig", null);
__decorate([
    (0, common_1.Put)('site-config'),
    (0, platform_1.RequirePermission)('website.settings.update'),
    (0, platform_1.Audit)({ category: 'website.settings', entityType: 'SystemSetting', action: 'update' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [update_site_config_dto_1.UpdateSiteConfigDto]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "updateSiteConfig", null);
exports.SettingsController = SettingsController = __decorate([
    (0, common_1.Controller)('api/website/settings'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [settings_service_1.SettingsService])
], SettingsController);
