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
const update_defaults_dto_1 = require("./dto/update-defaults.dto");
const platform_1 = require("./platform");
const settings_service_1 = require("./settings.service");
/**
 * The module's own minimal settings surface — see settings.service.ts's own
 * docblock for why this exists instead of a generic core Settings-screen
 * endpoint (that generic surface doesn't exist yet, root docs/DECISIONS.md D70).
 */
let SettingsController = class SettingsController {
    settings;
    constructor(settings) {
        this.settings = settings;
    }
    async getDefaults() {
        return this.settings.getDefaults();
    }
    async updateDefaults(dto, user) {
        return this.settings.updateDefaults(dto, user.userId);
    }
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Get)('defaults'),
    (0, platform_1.RequirePermission)('template.settings.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getDefaults", null);
__decorate([
    (0, common_1.Put)('defaults'),
    (0, platform_1.RequirePermission)('template.settings.update'),
    (0, platform_1.Audit)({ category: 'template.settings', entityType: 'SystemSetting', action: 'update' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [update_defaults_dto_1.UpdateDefaultsDto, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "updateDefaults", null);
exports.SettingsController = SettingsController = __decorate([
    (0, common_1.Controller)('api/template/settings'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [settings_service_1.SettingsService])
], SettingsController);
