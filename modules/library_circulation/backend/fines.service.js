"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var FinesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const exceljs_1 = __importDefault(require("exceljs"));
const notifications_sender_1 = require("./notifications-sender");
const OPEN_FINE_STATUSES = ['unpaid', 'partially_paid'];
const LATE_FINE_TYPE_CODE = 'FINE-LATE';
/**
 * The library_finance half of this module (§11-14): fines, the
 * financial_transactions "charge" ledger, payments, and receipts. Own
 * dedicated `PrismaClient` (D57 pattern).
 */
let FinesService = FinesService_1 = class FinesService {
    notifications;
    logger = new common_1.Logger(FinesService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(notifications) {
        this.notifications = notifications;
    }
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
    /**
     * Fines page's filter bar. `createdByName`/`studentSearch` are resolved
     * from a name search down to real User/LibraryStudent ids first (same
     * two-pass approach as `getFilteredPayments` — this dedicated Prisma
     * client has no declared relation to filter through directly). Returns
     * rows enriched with the reader's code/name, fine type name, and
     * creator's name, plus the filtered set's total amount — so the page
     * never needs a second round trip just to show "who"/"how much" columns.
     */
    async list(filter) {
        const createdAt = {};
        if (filter.dateFrom)
            createdAt.gte = new Date(filter.dateFrom);
        if (filter.dateTo) {
            const end = new Date(filter.dateTo);
            end.setHours(23, 59, 59, 999);
            createdAt.lte = end;
        }
        let createdByIds;
        if (filter.createdByName) {
            const users = await this.prisma.user.findMany({
                where: { name: { contains: filter.createdByName, mode: 'insensitive' } },
                select: { id: true },
            });
            createdByIds = users.map((u) => u.id);
            if (createdByIds.length === 0)
                return { fines: [], totalAmount: 0 };
        }
        let studentIds;
        if (filter.studentSearch) {
            const matchingUsers = await this.prisma.user.findMany({
                where: { name: { contains: filter.studentSearch, mode: 'insensitive' } },
                select: { id: true },
            });
            const students = await this.prisma.libraryStudent.findMany({
                where: {
                    OR: [
                        { code: { contains: filter.studentSearch, mode: 'insensitive' } },
                        ...(matchingUsers.length ? [{ userId: { in: matchingUsers.map((u) => u.id) } }] : []),
                    ],
                },
                select: { id: true },
            });
            studentIds = students.map((s) => s.id);
            if (studentIds.length === 0)
                return { fines: [], totalAmount: 0 };
        }
        const amount = {};
        if (filter.amountMin !== undefined)
            amount.gte = filter.amountMin;
        if (filter.amountMax !== undefined)
            amount.lte = filter.amountMax;
        const fines = await this.prisma.libraryFine.findMany({
            where: {
                studentId: filter.studentId ?? (studentIds ? { in: studentIds } : undefined),
                status: filter.status?.length ? { in: filter.status } : undefined,
                fineTypeId: filter.fineTypeId,
                createdBy: createdByIds ? { in: createdByIds } : undefined,
                ...(Object.keys(createdAt).length ? { createdAt } : {}),
                ...(Object.keys(amount).length ? { amount } : {}),
            },
            orderBy: { createdAt: 'desc' },
        });
        if (fines.length === 0)
            return { fines: [], totalAmount: 0 };
        const studentIdsToResolve = [...new Set(fines.map((f) => f.studentId))];
        const students = await this.prisma.libraryStudent.findMany({ where: { id: { in: studentIdsToResolve } } });
        const studentById = new Map(students.map((s) => [s.id, s]));
        const fineTypeIds = [...new Set(fines.map((f) => f.fineTypeId))];
        const fineTypes = fineTypeIds.length ? await this.prisma.libraryFineType.findMany({ where: { id: { in: fineTypeIds } } }) : [];
        const fineTypeById = new Map(fineTypes.map((ft) => [ft.id, ft]));
        const userIds = [...new Set([...fines.map((f) => f.createdBy), ...students.map((s) => s.userId)])];
        const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
        const nameById = new Map(users.map((u) => [u.id, u.name]));
        const enriched = fines.map((fine) => {
            const student = studentById.get(fine.studentId);
            return {
                ...fine,
                createdByName: nameById.get(fine.createdBy) ?? null,
                studentCode: student?.code ?? null,
                studentName: student ? (nameById.get(student.userId) ?? null) : null,
                fineTypeName: fineTypeById.get(fine.fineTypeId)?.name ?? null,
            };
        });
        const totalAmount = enriched.reduce((sum, f) => sum + Number(f.amount), 0);
        return { fines: enriched, totalAmount };
    }
    /**
     * Fine details — who recorded it and who received each payment against
     * it are resolved to real names here (`createdBy`/`receivedBy` are just
     * User UUIDs on the raw rows), plus the book/borrowing context (title,
     * return status, days late) a librarian actually needs to make sense of
     * WHY this fine exists, none of which the raw LibraryFine row carries on
     * its own (it only stores `borrowingId`).
     */
    async findById(id) {
        const fine = await this.getOrThrow(id);
        const transaction = await this.prisma.libraryFinancialTransaction.findFirst({ where: { fineId: id } });
        const payments = transaction
            ? await this.prisma.libraryPayment.findMany({ where: { transactionId: transaction.id }, orderBy: { paidAt: 'asc' } })
            : [];
        const userIds = [...new Set([fine.createdBy, ...payments.map((p) => p.receivedBy)])];
        const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
        const nameById = new Map(users.map((u) => [u.id, u.name]));
        let borrowingContext = null;
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
    async update(id, dto, allowAfterPayment) {
        const fine = await this.getOrThrow(id);
        if (fine.status === 'waived' || fine.status === 'cancelled') {
            throw new common_1.ConflictException(`A "${fine.status}" fine cannot be edited.`);
        }
        if (fine.status === 'paid' && !allowAfterPayment) {
            throw new common_1.ConflictException('This fine is already paid — editing it requires the fines.update_after_payment permission.');
        }
        if (dto.amount !== undefined && dto.amount < Number(fine.amountPaid)) {
            throw new common_1.BadRequestException(`New amount (${dto.amount}) cannot be less than what's already been paid (${fine.amountPaid}).`);
        }
        // Status is always re-derived from the (possibly new) amount vs. what's
        // already been paid — never left stale. Only unpaid/partially_paid/paid
        // are reachable here (waived/cancelled were already rejected above).
        const newStatus = (() => {
            if (dto.amount === undefined)
                return undefined;
            const paid = Number(fine.amountPaid);
            if (paid <= 0)
                return 'unpaid';
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
    async waive(id) {
        const fine = await this.getOrThrow(id);
        if (fine.status === 'paid') {
            throw new common_1.ConflictException('A fully paid fine cannot be waived.');
        }
        return this.prisma.libraryFine.update({ where: { id }, data: { status: 'waived' } });
    }
    /** §12-13: creates a payment against the fine's transaction, then a matching receipt. Guards overpayment (§22). */
    async recordPayment(fineId, amount, receivedBy, paymentMethod) {
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
    async getFinanceSummary() {
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
    /**
     * Finance page's Payments tab — date range + "who recorded the underlying
     * fine" + "who received the payment" filters, each resolved from a name
     * search down to the real `receivedBy`/fine.`createdBy` User ids (this
     * dedicated Prisma client has no declared relation from LibraryPayment to
     * User to filter through directly, per the D57 cross-module-read pattern
     * — every module-owned table here is read via plain queries, not Prisma
     * relation joins). Returns the filtered rows already enriched with both
     * names plus the fine number/amount they belong to, and the filtered
     * set's total amount, so the page doesn't need a second aggregate call.
     */
    async listPayments(filter = {}) {
        return this.getFilteredPayments(filter);
    }
    /** Same filter/enrichment as listPayments() — factored out so the Excel export can never see a different result set than what the page just showed. */
    async getFilteredPayments(filter) {
        const paidAt = {};
        if (filter.dateFrom)
            paidAt.gte = new Date(filter.dateFrom);
        if (filter.dateTo) {
            // Inclusive of the whole "to" day.
            const end = new Date(filter.dateTo);
            end.setHours(23, 59, 59, 999);
            paidAt.lte = end;
        }
        let receivedByIds;
        if (filter.receivedByName) {
            const users = await this.prisma.user.findMany({
                where: { name: { contains: filter.receivedByName, mode: 'insensitive' } },
                select: { id: true },
            });
            receivedByIds = users.map((u) => u.id);
            if (receivedByIds.length === 0)
                return { payments: [], totalAmount: 0 };
        }
        const payments = await this.prisma.libraryPayment.findMany({
            where: {
                ...(Object.keys(paidAt).length ? { paidAt } : {}),
                ...(receivedByIds ? { receivedBy: { in: receivedByIds } } : {}),
            },
            orderBy: { paidAt: 'desc' },
        });
        if (payments.length === 0)
            return { payments: [], totalAmount: 0 };
        const transactionIds = [...new Set(payments.map((p) => p.transactionId))];
        const transactions = await this.prisma.libraryFinancialTransaction.findMany({ where: { id: { in: transactionIds } } });
        const transactionById = new Map(transactions.map((t) => [t.id, t]));
        const fineIds = [...new Set(transactions.map((t) => t.fineId))];
        let fines = fineIds.length ? await this.prisma.libraryFine.findMany({ where: { id: { in: fineIds } } }) : [];
        if (filter.createdByName) {
            const creators = await this.prisma.user.findMany({
                where: { name: { contains: filter.createdByName, mode: 'insensitive' } },
                select: { id: true },
            });
            const creatorIds = new Set(creators.map((u) => u.id));
            fines = fines.filter((f) => creatorIds.has(f.createdBy));
        }
        const fineById = new Map(fines.map((f) => [f.id, f]));
        // Reader (name + code) each payment's fine belongs to — the payer, which a cashier needs to recognise the row.
        const students = fines.length
            ? await this.prisma.libraryStudent.findMany({ where: { id: { in: [...new Set(fines.map((f) => f.studentId))] } } })
            : [];
        const studentById = new Map(students.map((st) => [st.id, st]));
        const userIds = [...new Set([...payments.map((p) => p.receivedBy), ...fines.map((f) => f.createdBy), ...students.map((st) => st.userId)])];
        const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
        const nameById = new Map(users.map((u) => [u.id, u.name]));
        const enriched = payments
            .map((payment) => {
            const transaction = transactionById.get(payment.transactionId);
            const fine = transaction ? fineById.get(transaction.fineId) : undefined;
            if (!fine)
                return null; // filtered out by createdByName above, or a genuine data-integrity gap either way
            return {
                ...payment,
                receivedByName: nameById.get(payment.receivedBy) ?? null,
                fineNumber: fine.fineNumber,
                fineAmount: fine.amount,
                studentCode: studentById.get(fine.studentId)?.code ?? null,
                studentName: studentById.has(fine.studentId) ? (nameById.get(studentById.get(fine.studentId).userId) ?? null) : null,
                createdBy: fine.createdBy,
                createdByName: nameById.get(fine.createdBy) ?? null,
            };
        })
            .filter((row) => row !== null);
        const totalAmount = enriched.reduce((sum, p) => sum + Number(p.amount), 0);
        return { payments: enriched, totalAmount };
    }
    /** Same filtered/enriched rows as listPayments(), as an .xlsx workbook — same shape as library_catalog's own exportBooksWorkbook(). */
    async exportPaymentsWorkbook(filter = {}) {
        const { payments, totalAmount } = await this.getFilteredPayments(filter);
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Payments');
        worksheet.columns = [
            { header: 'payment_number', key: 'paymentNumber', width: 16 },
            { header: 'fine_number', key: 'fineNumber', width: 16 },
            { header: 'reader', key: 'reader', width: 28 },
            { header: 'amount', key: 'amount', width: 12 },
            { header: 'payment_method', key: 'paymentMethod', width: 14 },
            { header: 'paid_at', key: 'paidAt', width: 18 },
            { header: 'received_by', key: 'receivedByName', width: 22 },
            { header: 'fine_created_by', key: 'createdByName', width: 22 },
        ];
        for (const payment of payments) {
            worksheet.addRow({
                paymentNumber: payment.paymentNumber,
                fineNumber: payment.fineNumber,
                reader: [payment.studentName, payment.studentCode ? `(${payment.studentCode})` : null].filter(Boolean).join(' '),
                amount: payment.amount,
                paymentMethod: payment.paymentMethod,
                paidAt: payment.paidAt.toISOString(),
                receivedByName: payment.receivedByName ?? '',
                createdByName: payment.createdByName ?? '',
            });
        }
        worksheet.addRow({});
        worksheet.addRow({ paymentNumber: 'TOTAL', amount: totalAmount });
        return workbook.xlsx.writeBuffer();
    }
    // --- internals -------------------------------------------------------
    async createFineWithTransaction(input) {
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
            await this.notifyStudent(student.userId, 'library_circulation.fine_created', 'غرامة جديدة', `تم إنشاء غرامة بقيمة ${input.amount} (${result.fineNumber}).`);
        }
        return result;
    }
    /** Never lets a notification failure fail the underlying fine/payment action (§23's UX addition, not a correctness requirement). */
    async notifyStudent(userId, category, title, bodyMarkdown) {
        try {
            await this.notifications.send({ category, title, bodyMarkdown, targetType: 'user', targetId: userId, sentBy: null });
        }
        catch (error) {
            this.logger.error(`Failed to notify student ${userId} ("${category}") — the underlying action itself succeeded.`, error);
        }
    }
    /** Sequence-backed, genuinely unique-under-concurrency human-readable numbers (§12/§14) — e.g. "FINE-000087". */
    async nextNumber(tx, sequenceName, prefix) {
        const rows = await tx.$queryRawUnsafe(`SELECT nextval('${sequenceName}') AS nextval`);
        return `${prefix}-${rows[0].nextval.toString().padStart(6, '0')}`;
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
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(notifications_sender_1.NOTIFICATIONS_SENDER)),
    __metadata("design:paramtypes", [Object])
], FinesService);
