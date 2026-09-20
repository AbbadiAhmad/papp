import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreateFineDto } from './dto/create-fine.dto';
import { PaymentMethod } from './dto/record-payment.dto';
import { UpdateFineDto } from './dto/update-fine.dto';
import { NOTIFICATIONS_SENDER, NotificationsSender } from './notifications-sender';

const OPEN_FINE_STATUSES = ['unpaid', 'partially_paid'] as const;
const LATE_FINE_TYPE_CODE = 'FINE-LATE';

type Tx = Prisma.TransactionClient;

/**
 * The library_finance half of this module (§11-14): fines, the
 * financial_transactions "charge" ledger, payments, and receipts. Own
 * dedicated `PrismaClient` (D57 pattern).
 */
@Injectable()
export class FinesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinesService.name);
  private readonly prisma = new PrismaClient();

  constructor(@Inject(NOTIFICATIONS_SENDER) private readonly notifications: NotificationsSender) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('library_circulation (fines) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async listFineTypes() {
    return this.prisma.libraryFineType.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  }

  async list(filter: { studentId?: string; status?: string }) {
    return this.prisma.libraryFine.findMany({
      where: { studentId: filter.studentId, status: filter.status },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Fine details — who recorded it and who received each payment against
   * it are resolved to real names here (`createdBy`/`receivedBy` are just
   * User UUIDs on the raw rows), plus the book/borrowing context (title,
   * return status, days late) a librarian actually needs to make sense of
   * WHY this fine exists, none of which the raw LibraryFine row carries on
   * its own (it only stores `borrowingId`).
   */
  async findById(id: string) {
    const fine = await this.getOrThrow(id);
    const transaction = await this.prisma.libraryFinancialTransaction.findFirst({ where: { fineId: id } });
    const payments = transaction
      ? await this.prisma.libraryPayment.findMany({ where: { transactionId: transaction.id }, orderBy: { paidAt: 'asc' } })
      : [];

    const userIds = [...new Set([fine.createdBy, ...payments.map((p) => p.receivedBy)])];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    let borrowingContext: {
      bookTitle: string | null;
      qrCode: string | null;
      returnStatus: string | null;
      dueAt: Date;
      returnedAt: Date | null;
      daysLate: number;
    } | null = null;
    if (fine.borrowingId) {
      const borrowing = await this.prisma.libraryBorrowing.findUnique({ where: { id: fine.borrowingId } });
      if (borrowing) {
        const copy = await this.prisma.libraryCatalogBookCopy.findUnique({ where: { id: borrowing.bookCopyId } });
        const book = copy ? await this.prisma.libraryCatalogBook.findUnique({ where: { id: copy.bookId } }) : null;
        const referenceDate = borrowing.returnedAt ?? new Date();
        const daysLate = Math.max(0, Math.ceil((referenceDate.getTime() - borrowing.dueAt.getTime()) / (24 * 60 * 60 * 1000)));
        borrowingContext = {
          bookTitle: book?.title ?? null,
          qrCode: copy?.qrCode ?? null,
          returnStatus: borrowing.returnStatus,
          dueAt: borrowing.dueAt,
          returnedAt: borrowing.returnedAt,
          daysLate,
        };
      }
    }

    return {
      ...fine,
      createdByName: nameById.get(fine.createdBy) ?? null,
      transaction,
      payments: payments.map((p) => ({ ...p, receivedByName: nameById.get(p.receivedBy) ?? null })),
      borrowingContext,
    };
  }

  /**
   * §14's explicit duplicate-fine-prevention rule: an identical OPEN fine
   * (same student + borrowing + fine type, still unpaid/partially paid)
   * requires `confirmDuplicate: true` to create a second one.
   */
  async create(dto: CreateFineDto, createdBy: string) {
    const [student, fineType] = await Promise.all([
      this.prisma.libraryStudent.findUnique({ where: { id: dto.studentId } }),
      this.prisma.libraryFineType.findUnique({ where: { id: dto.fineTypeId } }),
    ]);
    if (!student) throw new NotFoundException('Student not found');
    if (!fineType) throw new NotFoundException('Fine type not found');

    if (!dto.confirmDuplicate) {
      const duplicate = await this.prisma.libraryFine.findFirst({
        where: {
          studentId: dto.studentId,
          borrowingId: dto.borrowingId ?? null,
          fineTypeId: dto.fineTypeId,
          status: { in: [...OPEN_FINE_STATUSES] },
        },
      });
      if (duplicate) {
        throw new ConflictException({
          message: 'An identical open fine already exists for this student/book/fine type. Resubmit with confirmDuplicate: true to create another.',
          existingFineId: duplicate.id,
        });
      }
    }

    return this.createFineWithTransaction({
      studentId: dto.studentId,
      borrowingId: dto.borrowingId,
      fineTypeId: dto.fineTypeId,
      amount: dto.amount,
      notes: dto.notes,
      createdBy,
    });
  }

  /**
   * Called by CirculationController right after a late return — auto-fines
   * are never subject to the manual-duplicate confirmation above (each
   * return event legitimately produces at most one late fine of its own).
   */
  async createLateFine(studentId: string, borrowingId: string, amount: number, createdBy: string) {
    const fineType = await this.prisma.libraryFineType.findUnique({ where: { code: LATE_FINE_TYPE_CODE } });
    if (!fineType) {
      this.logger.error(`Fine type "${LATE_FINE_TYPE_CODE}" is missing — seed data was not applied. Skipping auto-fine.`);
      return null;
    }
    return this.createFineWithTransaction({ studentId, borrowingId, fineTypeId: fineType.id, amount, createdBy });
  }

  /**
   * Editing a fine's amount/notes. Two routes call this (FinesController):
   * PATCH /fines/:id (gated `fines.record`, the same permission that creates
   * a fine) only while the fine is still unpaid/partially_paid, and PATCH
   * /fines/:id/after-payment (gated the more privileged
   * `fines.update_after_payment`) once it's `paid` — a waived/cancelled fine
   * is never editable either way, it's already a closed/void record.
   * `allowAfterPayment` is which of those two routes called in, so this one
   * method enforces the right precondition for each rather than duplicating
   * the update logic per route.
   */
  async update(id: string, dto: UpdateFineDto, allowAfterPayment: boolean) {
    const fine = await this.getOrThrow(id);
    if (fine.status === 'waived' || fine.status === 'cancelled') {
      throw new ConflictException(`A "${fine.status}" fine cannot be edited.`);
    }
    if (fine.status === 'paid' && !allowAfterPayment) {
      throw new ConflictException('This fine is already paid — editing it requires the fines.update_after_payment permission.');
    }
    if (dto.amount !== undefined && dto.amount < Number(fine.amountPaid)) {
      throw new BadRequestException(
        `New amount (${dto.amount}) cannot be less than what's already been paid (${fine.amountPaid}).`,
      );
    }

    // Status is always re-derived from the (possibly new) amount vs. what's
    // already been paid — never left stale. Only unpaid/partially_paid/paid
    // are reachable here (waived/cancelled were already rejected above).
    const newStatus = (() => {
      if (dto.amount === undefined) return undefined;
      const paid = Number(fine.amountPaid);
      if (paid <= 0) return 'unpaid';
      return paid >= dto.amount - 0.0001 ? 'paid' : 'partially_paid';
    })();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.libraryFine.update({
        where: { id },
        data: { amount: dto.amount, notes: dto.notes, status: newStatus },
      });
      if (dto.amount !== undefined) {
        // The ledger transaction amount mirrors the fine's own amount (§12) — keep them in sync, never let them drift apart.
        await tx.libraryFinancialTransaction.updateMany({ where: { fineId: id }, data: { amount: dto.amount } });
      }
      return updated;
    });
  }

  async waive(id: string) {
    const fine = await this.getOrThrow(id);
    if (fine.status === 'paid') {
      throw new ConflictException('A fully paid fine cannot be waived.');
    }
    return this.prisma.libraryFine.update({ where: { id }, data: { status: 'waived' } });
  }

  /** §12-13: creates a payment against the fine's transaction, then a matching receipt. Guards overpayment (§22). */
  async recordPayment(fineId: string, amount: number, receivedBy: string, paymentMethod: PaymentMethod) {
    const fine = await this.getOrThrow(fineId);
    if (fine.status === 'paid' || fine.status === 'waived' || fine.status === 'cancelled') {
      throw new ConflictException(`This fine is already "${fine.status}" — no further payment can be recorded.`);
    }
    const remaining = Number(fine.amount) - Number(fine.amountPaid);
    if (amount > remaining + 0.0001) {
      throw new BadRequestException(`Payment of ${amount} exceeds the remaining balance of ${remaining.toFixed(2)} (§22 overpayment guard).`);
    }

    const transaction = await this.prisma.libraryFinancialTransaction.findFirst({ where: { fineId } });
    if (!transaction) {
      throw new ConflictException('This fine has no financial transaction on record — data integrity issue, contact an admin.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.libraryPayment.create({
        data: {
          paymentNumber: await this.nextNumber(tx, 'library_payment_number_seq', 'PAY'),
          transactionId: transaction.id,
          amount,
          paymentMethod,
          receivedBy,
        },
      });
      const receipt = await tx.libraryReceipt.create({
        data: { paymentId: payment.id, receiptNumber: await this.nextNumber(tx, 'library_receipt_number_seq', 'REC') },
      });
      const newAmountPaid = Number(fine.amountPaid) + amount;
      const newStatus = newAmountPaid >= Number(fine.amount) - 0.0001 ? 'paid' : 'partially_paid';
      const updatedFine = await tx.libraryFine.update({
        where: { id: fineId },
        data: { amountPaid: newAmountPaid, status: newStatus },
      });
      return { payment, receipt, fine: updatedFine };
    });

    const student = await this.prisma.libraryStudent.findUnique({ where: { id: fine.studentId } });
    if (student) {
      await this.notifyStudent(student.userId, 'library_circulation.payment_recorded', 'تسجيل دفعة', 'تم تسجيل الدفع.');
    }

    return result;
  }

  /** §18's dashboard cards — real aggregates over `library_fines`, never mock data. */
  async getFinanceSummary(): Promise<{ unpaidTotal: number; paidTotal: number }> {
    const fines = await this.prisma.libraryFine.findMany({
      where: { status: { in: ['unpaid', 'partially_paid', 'paid'] } },
      select: { amount: true, amountPaid: true },
    });
    let unpaidTotal = 0;
    let paidTotal = 0;
    for (const fine of fines) {
      paidTotal += Number(fine.amountPaid);
      unpaidTotal += Number(fine.amount) - Number(fine.amountPaid);
    }
    return { unpaidTotal, paidTotal };
  }

  async listTransactions() {
    return this.prisma.libraryFinancialTransaction.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async listPayments() {
    return this.prisma.libraryPayment.findMany({ orderBy: { paidAt: 'desc' } });
  }

  // --- internals -------------------------------------------------------

  private async createFineWithTransaction(input: {
    studentId: string;
    borrowingId?: string;
    fineTypeId: string;
    amount: number;
    notes?: string;
    createdBy: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const fine = await tx.libraryFine.create({
        data: {
          fineNumber: await this.nextNumber(tx, 'library_fine_number_seq', 'FINE'),
          studentId: input.studentId,
          borrowingId: input.borrowingId,
          fineTypeId: input.fineTypeId,
          amount: input.amount,
          notes: input.notes,
          createdBy: input.createdBy,
        },
      });
      const transaction = await tx.libraryFinancialTransaction.create({
        data: {
          fineId: fine.id,
          transactionNumber: await this.nextNumber(tx, 'library_transaction_number_seq', 'FIN'),
          amount: input.amount,
        },
      });
      return { ...fine, transaction };
    });

    const student = await this.prisma.libraryStudent.findUnique({ where: { id: input.studentId } });
    if (student) {
      await this.notifyStudent(
        student.userId,
        'library_circulation.fine_created',
        'غرامة جديدة',
        `تم إنشاء غرامة بقيمة ${input.amount} (${result.fineNumber}).`,
      );
    }

    return result;
  }

  /** Never lets a notification failure fail the underlying fine/payment action (§23's UX addition, not a correctness requirement). */
  private async notifyStudent(userId: string, category: string, title: string, bodyMarkdown: string): Promise<void> {
    try {
      await this.notifications.send({ category, title, bodyMarkdown, targetType: 'user', targetId: userId, sentBy: null });
    } catch (error) {
      this.logger.error(`Failed to notify student ${userId} ("${category}") — the underlying action itself succeeded.`, error);
    }
  }

  /** Sequence-backed, genuinely unique-under-concurrency human-readable numbers (§12/§14) — e.g. "FINE-000087". */
  private async nextNumber(tx: Tx, sequenceName: string, prefix: string): Promise<string> {
    const rows = await tx.$queryRawUnsafe<Array<{ nextval: bigint }>>(`SELECT nextval('${sequenceName}') AS nextval`);
    return `${prefix}-${rows[0].nextval.toString().padStart(6, '0')}`;
  }

  private async getOrThrow(id: string) {
    const fine = await this.prisma.libraryFine.findUnique({ where: { id } });
    if (!fine) throw new NotFoundException('Fine not found');
    return fine;
  }
}
