import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SettingsService } from './settings.service';

const ACTIVE_BORROWING_STATUSES = ['active', 'overdue'] as const;

export type ScanResult =
  | { type: 'student'; student: Record<string, unknown>; activeBorrowingsCount: number }
  | { type: 'book_copy'; copy: Record<string, unknown>; book: Record<string, unknown> | null; activeBorrowing: Record<string, unknown> | null };

/**
 * The scan/borrow/return flows (§6/§7/§9 — "the most important screen") plus
 * the per-student borrowing-limit protection rule (§22). Own dedicated
 * `PrismaClient` (D57 pattern). Deliberately reads `library_catalog_book_copies`
 * directly through this shared Prisma client rather than calling into
 * library_catalog's own NestJS module — the two modules stay decoupled at
 * the service level, coupled only through the shared DB tables their
 * manifests' `dependsOn` already declares.
 */
@Injectable()
export class CirculationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CirculationService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly settings: SettingsService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('library_circulation (circulation) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Auto-detects the scanned code's type by prefix (§6: STU/BOOK), falling
   * back to trying both lookups for a code that doesn't follow the printed
   * convention — never a hard requirement, since the prefix is a labeling
   * convention this module encourages, not a DB constraint on either table.
   */
  async scan(rawCode: string): Promise<ScanResult> {
    const code = rawCode.trim();
    const upper = code.toUpperCase();

    if (upper.startsWith('STU')) return this.scanStudent(code);
    if (upper.startsWith('BOOK')) return this.scanBookCopy(code);

    const student = await this.prisma.libraryStudent.findUnique({ where: { code } });
    if (student) return this.scanStudent(code);
    const copy = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { qrCode: code } });
    if (copy) return this.scanBookCopy(code);

    throw new NotFoundException(`No student or book copy found for code "${code}"`);
  }

  private async scanStudent(code: string): Promise<ScanResult> {
    const student = await this.prisma.libraryStudent.findUnique({ where: { code } });
    if (!student) throw new NotFoundException(`No student found for code "${code}"`);
    const user = await this.prisma.user.findUnique({ where: { id: student.userId } });
    const activeBorrowingsCount = await this.prisma.libraryBorrowing.count({
      where: { studentId: student.id, status: { in: [...ACTIVE_BORROWING_STATUSES] } },
    });
    return {
      type: 'student',
      student: { ...student, name: user?.name ?? null, email: user?.email ?? null },
      activeBorrowingsCount,
    };
  }

  private async scanBookCopy(qrCode: string): Promise<ScanResult> {
    const copy = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { qrCode } });
    if (!copy) throw new NotFoundException(`No book copy found for code "${qrCode}"`);
    const book = await this.prisma.libraryCatalogBook.findUnique({ where: { id: copy.bookId } });
    const activeBorrowing = await this.prisma.libraryBorrowing.findFirst({
      where: { bookCopyId: copy.id, status: { in: [...ACTIVE_BORROWING_STATUSES] } },
    });
    return { type: 'book_copy', copy, book, activeBorrowing };
  }

  /** §7's minimum-steps borrow flow, wrapped in one transaction (§31). */
  async borrow(studentId: string, bookCopyId: string, borrowedBy: string) {
    const policy = await this.settings.getLoanPolicy();

    const [student, copy] = await Promise.all([
      this.prisma.libraryStudent.findUnique({ where: { id: studentId } }),
      this.prisma.libraryCatalogBookCopy.findUnique({ where: { id: bookCopyId } }),
    ]);
    if (!student) throw new NotFoundException('Student not found');
    if (!copy) throw new NotFoundException('Book copy not found');
    if (copy.status !== 'available') {
      throw new ConflictException(`This copy is currently "${copy.status}" and cannot be borrowed (§22).`);
    }

    const activeCount = await this.prisma.libraryBorrowing.count({
      where: { studentId, status: { in: [...ACTIVE_BORROWING_STATUSES] } },
    });
    if (activeCount >= policy.maxBooksPerStudent) {
      throw new ConflictException(
        `This student already has ${activeCount} book(s) borrowed, at the policy limit of ${policy.maxBooksPerStudent} (§22).`,
      );
    }

    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + policy.loanPeriodDays);

    return this.prisma.$transaction(async (tx) => {
      const borrowing = await tx.libraryBorrowing.create({
        data: { bookCopyId, studentId, dueAt, borrowedBy, status: 'active' },
      });
      await tx.libraryCatalogBookCopy.update({ where: { id: bookCopyId }, data: { status: 'borrowed' } });
      return borrowing;
    });
  }

  /**
   * §9's return flow: marks the borrowing returned and reports how many
   * days late it was (0 if on time) — the caller (FinesService, via the
   * controller) uses that to auto-create a late fine when policy requires
   * one; this method never creates fines itself, keeping the two concerns
   * (circulation state vs. money) separated the same way library_finance's
   * own tables are.
   */
  async returnBorrowing(borrowingId: string, returnedBy: string): Promise<{ borrowing: unknown; daysLate: number }> {
    const borrowing = await this.prisma.libraryBorrowing.findUnique({ where: { id: borrowingId } });
    if (!borrowing) throw new NotFoundException('Borrowing not found');
    if (borrowing.status !== 'active' && borrowing.status !== 'overdue') {
      throw new ConflictException(`This borrowing is already "${borrowing.status}" and cannot be returned (§22).`);
    }

    const returnedAt = new Date();
    const daysLate = Math.max(0, Math.ceil((returnedAt.getTime() - borrowing.dueAt.getTime()) / (24 * 60 * 60 * 1000)));

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.libraryBorrowing.update({
        where: { id: borrowingId },
        data: { status: 'returned', returnedAt, returnedBy },
      });
      await tx.libraryCatalogBookCopy.update({ where: { id: borrowing.bookCopyId }, data: { status: 'available' } });
      return result;
    });

    return { borrowing: updated, daysLate };
  }

  async getLoanPolicy() {
    return this.settings.getLoanPolicy();
  }

  async findBorrowing(id: string) {
    const borrowing = await this.prisma.libraryBorrowing.findUnique({ where: { id } });
    if (!borrowing) throw new NotFoundException('Borrowing not found');
    return borrowing;
  }

  /** §9: returning by scanning the BOOK (rather than the student) needs the copy's current active borrowing. */
  async findActiveBorrowingForCopy(bookCopyId: string) {
    const borrowing = await this.prisma.libraryBorrowing.findFirst({
      where: { bookCopyId, status: { in: [...ACTIVE_BORROWING_STATUSES] } },
    });
    if (!borrowing) {
      throw new NotFoundException('This copy has no active borrowing to return');
    }
    return borrowing;
  }
}
