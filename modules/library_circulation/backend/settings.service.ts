import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { UpdateLoanPolicyDto } from './dto/update-loan-policy.dto';
import { UpdateReaderCardDto } from './dto/update-reader-card.dto';

export const READER_CARD_KEY = 'library_circulation.reader_card';

export interface ReaderCardSettings {
  headerText: string;
}

export const LOAN_POLICY_KEY = 'library_circulation.loan_policy';
export const LOAN_POLICY_FALLBACK: LoanPolicy = { maxBooksPerStudent: 5, loanPeriodDays: 14, finePerDay: 1, fineUnit: 'day', maxFine: 0 };

export interface LoanPolicy {
  maxBooksPerStudent: number;
  loanPeriodDays: number;
  /** Late fine per `fineUnit`. Kept under its original key for existing installs; decimals allowed. */
  finePerDay: number;
  fineUnit: 'day' | 'week';
  /** Cap on one borrowing's late fine; 0 = unlimited. */
  maxFine: number;
}

/**
 * The late fine for a return `daysLate` days late: the rate times the number
 * of units (days, or STARTED weeks — 1 to 7 days late is one week), rounded
 * to cents, never above `maxFine` when one is set. The frontend's return
 * dialog mirrors this rule to pre-fill its suggestion.
 */
export function computeLateFine(daysLate: number, policy: Pick<LoanPolicy, 'finePerDay' | 'fineUnit' | 'maxFine'>): number {
  if (daysLate <= 0 || policy.finePerDay <= 0) return 0;
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
      finePerDay: Number(value?.finePerDay ?? LOAN_POLICY_FALLBACK.finePerDay),
      fineUnit: value?.fineUnit === 'week' ? 'week' : 'day',
      maxFine: Number(value?.maxFine ?? LOAN_POLICY_FALLBACK.maxFine),
    };
  }

  async updateLoanPolicy(dto: UpdateLoanPolicyDto): Promise<LoanPolicy> {
    const value: LoanPolicy = { maxBooksPerStudent: dto.maxBooksPerStudent, loanPeriodDays: dto.loanPeriodDays, finePerDay: dto.finePerDay, fineUnit: dto.fineUnit, maxFine: dto.maxFine };
    await this.prisma.systemSetting.upsert({
      where: { key: LOAN_POLICY_KEY },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { key: LOAN_POLICY_KEY, value: value as unknown as Prisma.InputJsonValue },
    });
    return value;
  }

  async getReaderCard(): Promise<ReaderCardSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: READER_CARD_KEY } });
    const value = row?.value as Partial<ReaderCardSettings> | undefined;
    return { headerText: typeof value?.headerText === 'string' ? value.headerText : '' };
  }

  async updateReaderCard(dto: UpdateReaderCardDto): Promise<ReaderCardSettings> {
    const value: ReaderCardSettings = { headerText: dto.headerText };
    await this.prisma.systemSetting.upsert({
      where: { key: READER_CARD_KEY },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { key: READER_CARD_KEY, value: value as unknown as Prisma.InputJsonValue },
    });
    return value;
  }
}
