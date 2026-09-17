"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = exports.SITE_CONFIG_FALLBACK = exports.SITE_CONFIG_KEY = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
exports.SITE_CONFIG_KEY = 'website.site_config';
exports.SITE_CONFIG_FALLBACK = { siteTitle: 'papp', logoUrl: null };
/**
 * Same documented gap/pattern as every other module's own minimal settings
 * endpoint (root D70/D71 — the generic per-module Settings-screen surface
 * doesn't exist yet): reads/writes the SAME shared `system_settings` table
 * directly via this module's own Prisma client.
 */
let SettingsService = SettingsService_1 = class SettingsService {
    logger = new common_1.Logger(SettingsService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('website (settings) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async getSiteConfig() {
        const row = await this.prisma.systemSetting.findUnique({ where: { key: exports.SITE_CONFIG_KEY } });
        const value = row?.value;
        return {
            siteTitle: value?.siteTitle ?? exports.SITE_CONFIG_FALLBACK.siteTitle,
            logoUrl: value?.logoUrl ?? exports.SITE_CONFIG_FALLBACK.logoUrl,
        };
    }
    async updateSiteConfig(dto) {
        const value = { siteTitle: dto.siteTitle, logoUrl: dto.logoUrl ?? null };
        await this.prisma.systemSetting.upsert({
            where: { key: exports.SITE_CONFIG_KEY },
            update: { value: value },
            create: { key: exports.SITE_CONFIG_KEY, value: value },
        });
        return value;
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = SettingsService_1 = __decorate([
    (0, common_1.Injectable)()
], SettingsService);
