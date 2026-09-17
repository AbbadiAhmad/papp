"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = exports.LOAN_POLICY_FALLBACK = exports.LOAN_POLICY_KEY = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
exports.LOAN_POLICY_KEY = 'library_circulation.loan_policy';
exports.LOAN_POLICY_FALLBACK = { maxBooksPerStudent: 5, loanPeriodDays: 14, finePerDay: 1 };
/**
 * Same documented gap/pattern as `modules/template/backend/settings.service.ts`
 * (root docs/DECISIONS.md D70/D71 — the generic per-module Settings-screen
 * surface doesn't exist yet): this module provides its own minimal
 * read/update endpoint over the SAME shared `system_settings` table.
 * §8 of docs/LIBRARY_MODULE_REQUIREMENTS.md is the literal motivating case
 * for the whole module-`settings` manifest mechanism — borrowing policy
 * must never be a hardcoded constant.
 */
let SettingsService = SettingsService_1 = class SettingsService {
    logger = new common_1.Logger(SettingsService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('library_circulation (settings) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async getLoanPolicy() {
        const row = await this.prisma.systemSetting.findUnique({ where: { key: exports.LOAN_POLICY_KEY } });
        const value = row?.value;
        return {
            maxBooksPerStudent: value?.maxBooksPerStudent ?? exports.LOAN_POLICY_FALLBACK.maxBooksPerStudent,
            loanPeriodDays: value?.loanPeriodDays ?? exports.LOAN_POLICY_FALLBACK.loanPeriodDays,
            finePerDay: value?.finePerDay ?? exports.LOAN_POLICY_FALLBACK.finePerDay,
        };
    }
    async updateLoanPolicy(dto) {
        const value = { maxBooksPerStudent: dto.maxBooksPerStudent, loanPeriodDays: dto.loanPeriodDays, finePerDay: dto.finePerDay };
        await this.prisma.systemSetting.upsert({
            where: { key: exports.LOAN_POLICY_KEY },
            update: { value: value },
            create: { key: exports.LOAN_POLICY_KEY, value: value },
        });
        return value;
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = SettingsService_1 = __decorate([
    (0, common_1.Injectable)()
], SettingsService);
