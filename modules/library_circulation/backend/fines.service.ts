import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreateFineDto } from './dto/create-fine.dto';
import { PaymentMethod } from './dto/record-payment.dto';
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

  async findById(id: string) {
    const fine = await this.getOrThrow(id);
    const transaction = await this.prisma.libraryFinancialTransaction.findFirst({ where: { fineId: id } });
    const payments = transaction
      ? await this.prisma.libraryPayment.findMany({ where: { transactionId: transaction.id }, orderBy: { paidAt: 'asc' } })
      : [];
    return { ...fine, transaction, payments };
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
