import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NOTIFICATIONS_SENDER, NotificationsSender } from './notifications-sender';
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

  constructor(
    private readonly settings: SettingsService,
    @Inject(NOTIFICATIONS_SENDER) private readonly notifications: NotificationsSender,
  ) {}

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
  async borrow(
    studentId: string,
    bookCopyId: string,
    borrowedBy: string,
    expectedReturnDate?: Date,
    comments?: string,
  ) {
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

    const dueAt = expectedReturnDate ?? (() => {
      const date = new Date();
      date.setDate(date.getDate() + policy.loanPeriodDays);
      return date;
    })();

    const borrowing = await this.prisma.$transaction(async (tx) => {
      const created = await tx.libraryBorrowing.create({
        data: { bookCopyId, studentId, dueAt, borrowedBy, status: 'active', comments },
      });
      await tx.libraryCatalogBookCopy.update({ where: { id: bookCopyId }, data: { status: 'borrowed' } });
      return created;
    });

    const book = await this.prisma.libraryCatalogBook.findUnique({ where: { id: copy.bookId } });
    await this.notifyStudent(
      student.userId,
      'library_circulation.borrow',
      'إعارة كتاب',
      `تمت إعارة القصة "${book?.title ?? ''}" بنجاح.`,
    );

    return borrowing;
  }

  /**
   * §9's return flow: marks the borrowing returned and reports how many
   * days late it was (0 if on time) — the caller (FinesService, via the
   * controller) uses that to auto-create a late fine when policy requires
   * one; this method never creates fines itself, keeping the two concerns
   * (circulation state vs. money) separated the same way library_finance's
   * own tables are.
   *
   * Feature D18: supports return status (returned/damaged/lost/other) and notes
   */
  async returnBorrowing(
    borrowingId: string,
    returnedBy: string,
    returnStatus?: string,
    returnNotes?: string,
  ): Promise<{ borrowing: unknown; daysLate: number }> {
    const borrowing = await this.prisma.libraryBorrowing.findUnique({ where: { id: borrowingId } });
    if (!borrowing) throw new NotFoundException('Borrowing not found');
    if (borrowing.status !== 'active' && borrowing.status !== 'overdue') {
      throw new ConflictException(`This borrowing is already "${borrowing.status}" and cannot be returned (§22).`);
    }

    const returnedAt = new Date();
    const daysLate = Math.max(0, Math.ceil((returnedAt.getTime() - borrowing.dueAt.getTime()) / (24 * 60 * 60 * 1000)));

    // Map return status to copy status
    const copyStatusMap: Record<string, string> = {
      returned: 'available',
      damaged: 'damaged',
      lost: 'lost',
      other: 'available',
    };
    const copyStatus = copyStatusMap[returnStatus ?? 'returned'] || 'available';

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.libraryBorrowing.update({
        where: { id: borrowingId },
        data: {
          status: 'returned',
          returnedAt,
          returnedBy,
          returnStatus: returnStatus || 'returned',
          returnNotes,
        },
      });
      await tx.libraryCatalogBookCopy.update({ where: { id: borrowing.bookCopyId }, data: { status: copyStatus } });
      return result;
    });

    const student = await this.prisma.libraryStudent.findUnique({ where: { id: borrowing.studentId } });
    if (student) {
      let body = 'تم إرجاع القصة.';
      if (daysLate > 0) {
        body = `تم إرجاع القصة. يوجد تأخير لمدة ${daysLate} يوم.`;
      }
      if (returnStatus && returnStatus !== 'returned') {
        body += ` الحالة: ${returnStatus}`;
      }
      await this.notifyStudent(student.userId, 'library_circulation.return', 'إرجاع كتاب', body);
    }

    return { borrowing: updated, daysLate };
  }

  /**
   * Extends an active/overdue borrowing's due date to a staff-picked new
   * date (no fixed policy multiplier, no cap on how many times a borrowing
   * can be extended — v1 scope per the user's own call, module DECISIONS.md).
   */
  async extendLoan(borrowingId: string, newDueDate: Date): Promise<unknown> {
    const borrowing = await this.prisma.libraryBorrowing.findUnique({ where: { id: borrowingId } });
    if (!borrowing) throw new NotFoundException('Borrowing not found');
    if (borrowing.status !== 'active' && borrowing.status !== 'overdue') {
      throw new ConflictException(`This borrowing is already "${borrowing.status}" and cannot be extended.`);
    }
    if (newDueDate.getTime() <= borrowing.dueAt.getTime()) {
      throw new ConflictException('The new due date must be after the current due date.');
    }

    const updated = await this.prisma.libraryBorrowing.update({
      where: { id: borrowingId },
      data: { dueAt: newDueDate },
    });

    const student = await this.prisma.libraryStudent.findUnique({ where: { id: borrowing.studentId } });
    if (student) {
      await this.notifyStudent(student.userId, 'library_circulation.extend', 'تمديد إعارة', 'تم تمديد فترة إعارة الكتاب بنجاح.');
    }

    return updated;
  }

  /** Never lets a notification failure fail the underlying circulation action (§23's UX addition, not a correctness requirement). */
  private async notifyStudent(userId: string, category: string, title: string, bodyMarkdown: string): Promise<void> {
    try {
      await this.notifications.send({ category, title, bodyMarkdown, targetType: 'user', targetId: userId, sentBy: null });
    } catch (error) {
      this.logger.error(`Failed to notify student ${userId} ("${category}") — the underlying action itself succeeded.`, error);
    }
  }

  async getLoanPolicy() {
    return this.settings.getLoanPolicy();
  }

  /** §18's dashboard cards — real aggregate counts, never mock data. */
  async getCopyStats(): Promise<{ totalCopies: number; availableCopies: number; borrowedCopies: number; overdueBorrowings: number }> {
    const [totalCopies, availableCopies, borrowedCopies, overdueBorrowings] = await Promise.all([
      this.prisma.libraryCatalogBookCopy.count(),
      this.prisma.libraryCatalogBookCopy.count({ where: { status: 'available' } }),
      this.prisma.libraryCatalogBookCopy.count({ where: { status: 'borrowed' } }),
      this.prisma.libraryBorrowing.count({
        where: { status: { in: [...ACTIVE_BORROWING_STATUSES] }, dueAt: { lt: new Date() } },
      }),
    ]);
    return { totalCopies, availableCopies, borrowedCopies, overdueBorrowings };
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

  /** Feature 2.2: Get circulation history for a copy or a specific borrowing. */
  async getCirculationHistory(bookCopyId?: string, borrowingId?: string, limit: number = 10) {
    const where: Record<string, unknown> = {};
    if (bookCopyId) {
      where.bookCopyId = bookCopyId;
    }
    if (borrowingId) {
      where.id = borrowingId;
    }

    const borrowings = await this.prisma.libraryBorrowing.findMany({
      where,
      orderBy: { borrowedAt: 'desc' },
      take: limit,
      include: { student: true },
    });

    return borrowings.map((b) => ({
      id: b.id,
      studentId: b.studentId,
      studentCode: b.student.code,
      borrowedAt: b.borrowedAt,
      dueAt: b.dueAt,
      returnedAt: b.returnedAt,
      status: b.status,
      comments: b.comments,
      borrowedBy: b.borrowedBy,
      returnedBy: b.returnedBy,
    }));
  }
}
