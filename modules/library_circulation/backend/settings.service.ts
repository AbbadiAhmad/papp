import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { UpdateLoanPolicyDto } from './dto/update-loan-policy.dto';

export const LOAN_POLICY_KEY = 'library_circulation.loan_policy';
export const LOAN_POLICY_FALLBACK: LoanPolicy = { maxBooksPerStudent: 5, loanPeriodDays: 14, finePerDay: 1 };

export interface LoanPolicy {
  maxBooksPerStudent: number;
  loanPeriodDays: number;
  finePerDay: number;
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
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('library_circulation (settings) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getLoanPolicy(): Promise<LoanPolicy> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: LOAN_POLICY_KEY } });
    const value = row?.value as Partial<LoanPolicy> | undefined;
    return {
      maxBooksPerStudent: value?.maxBooksPerStudent ?? LOAN_POLICY_FALLBACK.maxBooksPerStudent,
      loanPeriodDays: value?.loanPeriodDays ?? LOAN_POLICY_FALLBACK.loanPeriodDays,
      finePerDay: value?.finePerDay ?? LOAN_POLICY_FALLBACK.finePerDay,
    };
  }

  async updateLoanPolicy(dto: UpdateLoanPolicyDto): Promise<LoanPolicy> {
    const value: LoanPolicy = { maxBooksPerStudent: dto.maxBooksPerStudent, loanPeriodDays: dto.loanPeriodDays, finePerDay: dto.finePerDay };
    await this.prisma.systemSetting.upsert({
      where: { key: LOAN_POLICY_KEY },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { key: LOAN_POLICY_KEY, value: value as unknown as Prisma.InputJsonValue },
    });
    return value;
  }
}
