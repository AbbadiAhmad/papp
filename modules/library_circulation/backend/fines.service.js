"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var FinesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const node_crypto_1 = require("node:crypto");
const OPEN_FINE_STATUSES = ['unpaid', 'partially_paid'];
const LATE_FINE_TYPE_CODE = 'FINE-LATE';
/** `TXN-20260917-3f9a1c2b` / `RC-20260917-3f9a1c2b` — unique (§12/§14), no shared sequence table needed. */
function generateNumber(prefix) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${prefix}-${date}-${(0, node_crypto_1.randomBytes)(4).toString('hex')}`;
}
/**
 * The library_finance half of this module (§11-14): fines, the
 * financial_transactions "charge" ledger, payments, and receipts. Own
 * dedicated `PrismaClient` (D57 pattern).
 */
let FinesService = FinesService_1 = class FinesService {
    logger = new common_1.Logger(FinesService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('library_circulation (fines) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async listFineTypes() {
        return this.prisma.libraryFineType.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
    }
    async list(filter) {
        return this.prisma.libraryFine.findMany({
            where: { studentId: filter.studentId, status: filter.status },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findById(id) {
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
    async create(dto, createdBy) {
        const [student, fineType] = await Promise.all([
            this.prisma.libraryStudent.findUnique({ where: { id: dto.studentId } }),
            this.prisma.libraryFineType.findUnique({ where: { id: dto.fineTypeId } }),
        ]);
        if (!student)
            throw new common_1.NotFoundException('Student not found');
        if (!fineType)
            throw new common_1.NotFoundException('Fine type not found');
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
                throw new common_1.ConflictException({
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
    async createLateFine(studentId, borrowingId, amount, createdBy) {
        const fineType = await this.prisma.libraryFineType.findUnique({ where: { code: LATE_FINE_TYPE_CODE } });
        if (!fineType) {
            this.logger.error(`Fine type "${LATE_FINE_TYPE_CODE}" is missing — seed data was not applied. Skipping auto-fine.`);
            return null;
        }
        return this.createFineWithTransaction({ studentId, borrowingId, fineTypeId: fineType.id, amount, createdBy });
    }
    async waive(id) {
        const fine = await this.getOrThrow(id);
        if (fine.status === 'paid') {
            throw new common_1.ConflictException('A fully paid fine cannot be waived.');
        }
        return this.prisma.libraryFine.update({ where: { id }, data: { status: 'waived' } });
    }
    /** §12-13: creates a payment against the fine's transaction, then a matching receipt. Guards overpayment (§22). */
    async recordPayment(fineId, amount, receivedBy) {
        const fine = await this.getOrThrow(fineId);
        if (fine.status === 'paid' || fine.status === 'waived' || fine.status === 'cancelled') {
            throw new common_1.ConflictException(`This fine is already "${fine.status}" — no further payment can be recorded.`);
        }
        const remaining = Number(fine.amount) - Number(fine.amountPaid);
        if (amount > remaining + 0.0001) {
            throw new common_1.BadRequestException(`Payment of ${amount} exceeds the remaining balance of ${remaining.toFixed(2)} (§22 overpayment guard).`);
        }
        const transaction = await this.prisma.libraryFinancialTransaction.findFirst({ where: { fineId } });
        if (!transaction) {
            throw new common_1.ConflictException('This fine has no financial transaction on record — data integrity issue, contact an admin.');
        }
        return this.prisma.$transaction(async (tx) => {
            const payment = await tx.libraryPayment.create({
                data: { transactionId: transaction.id, amount, receivedBy },
            });
            const receipt = await tx.libraryReceipt.create({
                data: { paymentId: payment.id, receiptNumber: generateNumber('RC') },
            });
            const newAmountPaid = Number(fine.amountPaid) + amount;
            const newStatus = newAmountPaid >= Number(fine.amount) - 0.0001 ? 'paid' : 'partially_paid';
            const updatedFine = await tx.libraryFine.update({
                where: { id: fineId },
                data: { amountPaid: newAmountPaid, status: newStatus },
            });
            return { payment, receipt, fine: updatedFine };
        });
    }
    async listTransactions() {
        return this.prisma.libraryFinancialTransaction.findMany({ orderBy: { createdAt: 'desc' } });
    }
    async listPayments() {
        return this.prisma.libraryPayment.findMany({ orderBy: { paidAt: 'desc' } });
    }
    // --- internals -------------------------------------------------------
    async createFineWithTransaction(input) {
        return this.prisma.$transaction(async (tx) => {
            const fine = await tx.libraryFine.create({
                data: {
                    studentId: input.studentId,
                    borrowingId: input.borrowingId,
                    fineTypeId: input.fineTypeId,
                    amount: input.amount,
                    notes: input.notes,
                    createdBy: input.createdBy,
                },
            });
            const transaction = await tx.libraryFinancialTransaction.create({
                data: { fineId: fine.id, transactionNumber: generateNumber('TXN'), amount: input.amount },
            });
            return { ...fine, transaction };
        });
    }
    async getOrThrow(id) {
        const fine = await this.prisma.libraryFine.findUnique({ where: { id } });
        if (!fine)
            throw new common_1.NotFoundException('Fine not found');
        return fine;
    }
};
exports.FinesService = FinesService;
exports.FinesService = FinesService = FinesService_1 = __decorate([
    (0, common_1.Injectable)()
], FinesService);
