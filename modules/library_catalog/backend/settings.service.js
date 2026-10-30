"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = exports.STICKER_SETTINGS_FALLBACK = exports.STICKER_LAYOUT_KEY = exports.STICKER_SETTINGS_KEY = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const sticker_layout_1 = require("./sticker-layout");
exports.STICKER_SETTINGS_KEY = 'library_catalog.sticker_header_text';
exports.STICKER_LAYOUT_KEY = 'library_catalog.sticker_layout';
exports.STICKER_SETTINGS_FALLBACK = { headerText: '' };
/**
 * This module's first `system_settings`-backed value (LIBRARY_CATALOG-D22) —
 * same minimal per-module Settings pattern as
 * `modules/library_circulation/backend/settings.service.ts`/
 * `modules/template/backend/settings.service.ts` (root D70/D71: the generic
 * per-module Settings-screen surface doesn't exist yet, so each module ships
 * its own tiny read/update endpoint over the SAME shared `system_settings`
 * table rather than inventing a module-local settings table). The sticker
 * header text (e.g. the school/library name) lives HERE, not in
 * `library_circulation`, because it's book/copy-sticker content and this
 * module already owns the copy data it gets printed alongside — confirmed
 * with the user rather than assumed, since `library_circulation` is where
 * QR rendering/printing was first built (A14) and could have looked like
 * the "natural" home.
 */
let SettingsService = SettingsService_1 = class SettingsService {
    logger = new common_1.Logger(SettingsService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('library_catalog (settings) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async getStickerSettings() {
        const row = await this.prisma.systemSetting.findUnique({ where: { key: exports.STICKER_SETTINGS_KEY } });
        const value = row?.value;
        return { headerText: value?.headerText ?? exports.STICKER_SETTINGS_FALLBACK.headerText };
    }
    async updateStickerSettings(dto) {
        const value = { headerText: dto.headerText };
        await this.prisma.systemSetting.upsert({
            where: { key: exports.STICKER_SETTINGS_KEY },
            update: { value: value },
            create: { key: exports.STICKER_SETTINGS_KEY, value: value },
        });
        return value;
    }
    /** The saved sticker layout (LIBRARY_CATALOG-D33), or the built-in default that reproduces the original sticker. */
    async getStickerLayout() {
        const row = await this.prisma.systemSetting.findUnique({ where: { key: exports.STICKER_LAYOUT_KEY } });
        return row ? (0, sticker_layout_1.normalizeLayout)(row.value) : sticker_layout_1.DEFAULT_LAYOUT;
    }
    async updateStickerLayout(raw) {
        const layout = (0, sticker_layout_1.normalizeLayout)(raw);
        await this.prisma.systemSetting.upsert({
            where: { key: exports.STICKER_LAYOUT_KEY },
            update: { value: layout },
            create: { key: exports.STICKER_LAYOUT_KEY, value: layout },
        });
        return layout;
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = SettingsService_1 = __decorate([
    (0, common_1.Injectable)()
], SettingsService);
