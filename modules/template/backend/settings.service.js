"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = exports.DEFAULT_STATUS_FALLBACK = exports.TEMPLATE_DEFAULTS_KEY = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
exports.TEMPLATE_DEFAULTS_KEY = 'template.defaults';
exports.DEFAULT_STATUS_FALLBACK = 'active';
/**
 * *** A real, documented gap this file works around — read before copying it ***
 *
 * docs/MODULE_SPEC.md §8.3 describes the core Settings screen growing "one
 * additional section per installed module that declares any `settings`
 * entries, rendered generically" — that generic UI/endpoint does not
 * actually exist anywhere in the codebase (confirmed: `roleAccessLocked` and
 * this generic-settings-surface are both declared in the manifest schema and
 * seeded at install time, but nothing reads them back afterward — see this
 * module's own DECISIONS.md and root docs/DECISIONS.md D70). Until that's
 * built, a module wanting its own admin-editable setting to actually be
 * editable provides its own minimal read/update endpoint, reading/writing
 * the SAME shared `system_settings` table (never a separate per-module
 * settings store, §8.2) directly via its own Prisma client. This is that
 * minimal endpoint — copy it if your module needs the same, delete it if it
 * doesn't (most modules won't need a `settings` entry at all).
 */
let SettingsService = SettingsService_1 = class SettingsService {
    logger = new common_1.Logger(SettingsService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('template (settings) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async getDefaults() {
        const row = await this.prisma.systemSetting.findUnique({ where: { key: exports.TEMPLATE_DEFAULTS_KEY } });
        const value = row?.value;
        return { defaultStatus: value?.defaultStatus ?? exports.DEFAULT_STATUS_FALLBACK };
    }
    async updateDefaults(dto, updatedBy) {
        await this.prisma.systemSetting.upsert({
            where: { key: exports.TEMPLATE_DEFAULTS_KEY },
            update: { value: { defaultStatus: dto.defaultStatus }, updatedBy },
            create: { key: exports.TEMPLATE_DEFAULTS_KEY, value: { defaultStatus: dto.defaultStatus }, updatedBy },
        });
        return { defaultStatus: dto.defaultStatus };
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = SettingsService_1 = __decorate([
    (0, common_1.Injectable)()
], SettingsService);
