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
exports.PublicController = void 0;
const common_1 = require("@nestjs/common");
const menus_service_1 = require("./menus.service");
const pages_service_1 = require("./pages.service");
const platform_1 = require("./platform");
const settings_service_1 = require("./settings.service");
/**
 * Read-only public surface (MODULE_SPEC.md §7.1: never redirects to login).
 * No `PublicThrottlerGuard` — that guard is required for public WRITE
 * endpoints (MODULE_SPEC.md §7.3); these are all reads.
 */
let PublicController = class PublicController {
    pages;
    menus;
    settings;
    constructor(pages, menus, settings) {
        this.pages = pages;
        this.menus = menus;
        this.settings = settings;
    }
    async getPageBySlug(slug) {
        return this.pages.findPublicBySlug(slug);
    }
    async getHomepage() {
        return this.pages.findPublicHomepage();
    }
    async getMenu(location) {
        return this.menus.listPublic(location);
    }
    async getSiteConfig() {
        return this.settings.getSiteConfig();
    }
};
exports.PublicController = PublicController;
__decorate([
    (0, common_1.Get)('pages/:slug'),
    (0, platform_1.Public)(),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "getPageBySlug", null);
__decorate([
    (0, common_1.Get)('homepage'),
    (0, platform_1.Public)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "getHomepage", null);
__decorate([
    (0, common_1.Get)('menus/:location'),
    (0, platform_1.Public)(),
    __param(0, (0, common_1.Param)('location')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "getMenu", null);
__decorate([
    (0, common_1.Get)('site-config'),
    (0, platform_1.Public)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "getSiteConfig", null);
exports.PublicController = PublicController = __decorate([
    (0, common_1.Controller)('api/website/public'),
    __metadata("design:paramtypes", [pages_service_1.PagesService,
        menus_service_1.MenusService,
        settings_service_1.SettingsService])
], PublicController);
