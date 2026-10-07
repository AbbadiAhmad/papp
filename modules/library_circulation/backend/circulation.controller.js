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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CirculationController = void 0;
const common_1 = require("@nestjs/common");
const borrow_dto_1 = require("./dto/borrow.dto");
const extend_loan_dto_1 = require("./dto/extend-loan.dto");
const list_borrowings_dto_1 = require("./dto/list-borrowings.dto");
const return_dto_1 = require("./dto/return.dto");
const scan_dto_1 = require("./dto/scan.dto");
const circulation_service_1 = require("./circulation.service");
const fines_service_1 = require("./fines.service");
const permission_checker_1 = require("./permission-checker");
const students_service_1 = require("./students.service");
const platform_1 = require("./platform");
const fetchBorrowingState = (prisma, req) => prisma.libraryBorrowing.findUnique({ where: { id: req.body?.borrowingId ?? '' } });
/**
 * The daily-use screens (§6/§7/§9/§30): scan, borrow, return. A late return
 * auto-creates a fine in the SAME request (§9: "auto-creates a fine if
 * policy requires") — `FinesService` is injected directly rather than the
 * controller making a second HTTP round-trip to itself.
 */
let CirculationController = class CirculationController {
    circulation;
    fines;
    readers;
    permissions;
    constructor(circulation, fines, readers, permissions) {
        this.circulation = circulation;
        this.fines = fines;
        this.readers = readers;
        this.permissions = permissions;
    }
    async scan(dto) {
        // A user who was just given the reader role has no profile/code yet — create it before looking the code up.
        await this.readers.syncReaderProfiles();
        return this.circulation.scan(dto.code);
    }
    /** Scan page's book picker (title / author / copy code). Before the `:copyId` routes for the usual Express ordering reason. */
    async searchBookCopies(q) {
        return this.circulation.searchBookCopies(q ?? '');
    }
    async activeBorrowingForCopy(copyId) {
        return this.circulation.findActiveBorrowingForCopy(copyId);
    }
    /** Borrowings status page's filter bar — see CirculationService.listBorrowings's own docblock. */
    async listBorrowings(filter) {
        return this.circulation.listBorrowings({
            studentId: filter.studentId,
            bookSearch: filter.bookSearch,
            status: filter.status,
            overdueOnly: filter.overdueOnly === 'true',
            borrowedFrom: filter.borrowedFrom,
            borrowedTo: filter.borrowedTo,
        });
    }
    /** Scan page's reader-centric view — this reader's active borrowings, enriched with book title/due date. */
    async activeBorrowingsForStudent(studentId) {
        return this.circulation.getActiveBorrowingsForStudent(studentId);
    }
    async getCopyCirculationHistory(copyId, limit) {
        const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 10;
        return this.circulation.getCirculationHistory(copyId, undefined, limitNumber);
    }
    /** §2.1 (docs/LIBRARY_IMPROVEMENTS.md) — every reader who ever borrowed any copy of this book. */
    async getBookCirculationHistory(bookId, limit) {
        const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 10;
        return this.circulation.getBookCirculationHistory(bookId, limitNumber);
    }
    async borrow(dto, user) {
        const expectedReturnDate = dto.expectedReturnDate ? new Date(dto.expectedReturnDate) : undefined;
        return this.circulation.borrow(dto.studentId, dto.bookCopyId, user.userId, expectedReturnDate, dto.comments);
    }
    async returnBorrowing(dto, user) {
        // "Paid now" spans two permissions; the route guard only checked `return`. Refuse BEFORE the return is
        // recorded, so a 403 never leaves a half-done return behind.
        if (dto.fine?.paid) {
            const held = await this.permissions.getEffectivePermissionCodes(user.userId);
            if (!held.has('library_circulation.finance.record_payment')) {
                throw new common_1.ForbiddenException('Missing required permission: library_circulation.finance.record_payment');
            }
        }
        const borrowingBefore = await this.circulation.findBorrowing(dto.borrowingId);
        const returnedAtOverride = dto.returnedAt ? new Date(dto.returnedAt) : undefined;
        const { borrowing, daysLate } = await this.circulation.returnBorrowing(dto.borrowingId, user.userId, dto.returnStatus, dto.returnNotes, returnedAtOverride);
        let lateFine = null;
        // Auto-create fines for late returns — skipped when the librarian already added an inline fine covering this same return (dto.fine below), to avoid double-charging.
        if (daysLate > 0 && !dto.fine) {
            const policy = await this.circulation.getLoanPolicy();
            const amount = daysLate * policy.finePerDay;
            if (amount > 0) {
                lateFine = await this.fines.createLateFine(borrowingBefore.studentId, dto.borrowingId, amount, user.userId);
            }
        }
        // The librarian's own explicit fine, entered inline in the return dialog (checkbox + amount/type), created in this same request.
        let recordedFine = null;
        let finePayment = null;
        let finePaymentError = null;
        if (dto.fine) {
            const result = await this.fines.createWithOptionalPayment({ studentId: borrowingBefore.studentId, borrowingId: dto.borrowingId, fineTypeId: dto.fine.fineTypeId, amount: dto.fine.amount, notes: dto.fine.notes }, user.userId, dto.fine.paid ? { method: dto.fine.paymentMethod ?? 'cash' } : null);
            recordedFine = result.fine;
            finePayment = result.payment;
            finePaymentError = result.paymentError;
        }
        // Auto-suggest fine for damage/loss (caller decides whether to create it) — only still relevant if the librarian didn't already add one inline above.
        let damageFine = null;
        if ((dto.returnStatus === 'damaged' || dto.returnStatus === 'lost') && !dto.fine) {
            damageFine = { suggested: true, reason: dto.returnStatus };
        }
        return { borrowing, daysLate, lateFine, recordedFine, finePayment, finePaymentError, damageFine };
    }
    async extendLoan(dto) {
        return this.circulation.extendLoan(dto.borrowingId, new Date(dto.newDueDate));
    }
};
exports.CirculationController = CirculationController;
__decorate([
    (0, common_1.Post)('scan'),
    (0, platform_1.RequirePermission)('library_circulation.borrow'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [scan_dto_1.ScanDto]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "scan", null);
__decorate([
    (0, common_1.Get)('book-copies/search'),
    (0, platform_1.RequirePermission)('library_circulation.borrow'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "searchBookCopies", null);
__decorate([
    (0, common_1.Get)('book-copies/:copyId/active-borrowing'),
    (0, platform_1.RequirePermission)('library_circulation.return'),
    __param(0, (0, common_1.Param)('copyId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "activeBorrowingForCopy", null);
__decorate([
    (0, common_1.Get)('borrowings'),
    (0, platform_1.RequirePermission)('library_circulation.borrowings.view'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_borrowings_dto_1.ListBorrowingsDto]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "listBorrowings", null);
__decorate([
    (0, common_1.Get)('students/:studentId/active-borrowings'),
    (0, platform_1.RequirePermission)('library_circulation.borrow'),
    __param(0, (0, common_1.Param)('studentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "activeBorrowingsForStudent", null);
__decorate([
    (0, common_1.Get)('copies/:copyId/circulation-history'),
    (0, platform_1.RequirePermission)('library_circulation.borrow'),
    __param(0, (0, common_1.Param)('copyId')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "getCopyCirculationHistory", null);
__decorate([
    (0, common_1.Get)('books/:bookId/circulation-history'),
    (0, platform_1.RequirePermission)('library_circulation.borrow'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "getBookCirculationHistory", null);
__decorate([
    (0, common_1.Post)('borrow'),
    (0, platform_1.RequirePermission)('library_circulation.borrow'),
    (0, platform_1.Audit)({ category: 'library_circulation.borrowings', entityType: 'LibraryBorrowing', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [borrow_dto_1.BorrowDto, Object]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "borrow", null);
__decorate([
    (0, common_1.Post)('return'),
    (0, platform_1.RequirePermission)('library_circulation.return'),
    (0, platform_1.Audit)({ category: 'library_circulation.borrowings', entityType: 'LibraryBorrowing', action: 'update', fetchState: fetchBorrowingState }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [return_dto_1.ReturnDto, Object]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "returnBorrowing", null);
__decorate([
    (0, common_1.Post)('extend'),
    (0, platform_1.RequirePermission)('library_circulation.extend'),
    (0, platform_1.Audit)({ category: 'library_circulation.borrowings', entityType: 'LibraryBorrowing', action: 'update', fetchState: fetchBorrowingState }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [extend_loan_dto_1.ExtendLoanDto]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "extendLoan", null);
exports.CirculationController = CirculationController = __decorate([
    (0, common_1.Controller)('api/library-circulation'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __param(3, (0, common_1.Inject)(permission_checker_1.PERMISSION_CHECKER)),
    __metadata("design:paramtypes", [circulation_service_1.CirculationService,
        fines_service_1.FinesService,
        students_service_1.StudentsService, Object])
], CirculationController);
