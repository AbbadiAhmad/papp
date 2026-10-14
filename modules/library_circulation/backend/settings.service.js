"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = exports.LOAN_POLICY_FALLBACK = exports.LOAN_POLICY_KEY = exports.READER_CARD_KEY = void 0;
exports.computeLateFine = computeLateFine;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
exports.READER_CARD_KEY = 'library_circulation.reader_card';
exports.LOAN_POLICY_KEY = 'library_circulation.loan_policy';
exports.LOAN_POLICY_FALLBACK = { maxBooksPerStudent: 5, loanPeriodDays: 14, finePerDay: 1, fineUnit: 'day', maxFine: 0 };
/**
 * The late fine for a return `daysLate` days late: the rate times the number
 * of units (days, or STARTED weeks — 1 to 7 days late is one week), rounded
 * to cents, never above `maxFine` when one is set. The frontend's return
 * dialog mirrors this rule to pre-fill its suggestion.
 */
function computeLateFine(daysLate, policy) {
    if (daysLate <= 0 || policy.finePerDay <= 0)
        return 0;
    const units = policy.fineUnit === 'week' ? Math.ceil(daysLate / 7) : daysLate;
    const amount = Math.round(units * policy.finePerDay * 100) / 100;
    return policy.maxFine > 0 ? Math.min(amount, policy.maxFine) : amount;
}
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
            finePerDay: Number(value?.finePerDay ?? exports.LOAN_POLICY_FALLBACK.finePerDay),
            fineUnit: value?.fineUnit === 'week' ? 'week' : 'day',
            maxFine: Number(value?.maxFine ?? exports.LOAN_POLICY_FALLBACK.maxFine),
        };
    }
    async updateLoanPolicy(dto) {
        const value = { maxBooksPerStudent: dto.maxBooksPerStudent, loanPeriodDays: dto.loanPeriodDays, finePerDay: dto.finePerDay, fineUnit: dto.fineUnit, maxFine: dto.maxFine };
        await this.prisma.systemSetting.upsert({
            where: { key: exports.LOAN_POLICY_KEY },
            update: { value: value },
            create: { key: exports.LOAN_POLICY_KEY, value: value },
        });
        return value;
    }
    async getReaderCard() {
        const row = await this.prisma.systemSetting.findUnique({ where: { key: exports.READER_CARD_KEY } });
        const value = row?.value;
        return { headerText: typeof value?.headerText === 'string' ? value.headerText : '' };
    }
    async updateReaderCard(dto) {
        const value = { headerText: dto.headerText };
        await this.prisma.systemSetting.upsert({
            where: { key: exports.READER_CARD_KEY },
            update: { value: value },
            create: { key: exports.READER_CARD_KEY, value: value },
        });
        return value;
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = SettingsService_1 = __decorate([
    (0, common_1.Injectable)()
], SettingsService);
