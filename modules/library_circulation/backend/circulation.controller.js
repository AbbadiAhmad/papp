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
const return_dto_1 = require("./dto/return.dto");
const scan_dto_1 = require("./dto/scan.dto");
const circulation_service_1 = require("./circulation.service");
const fines_service_1 = require("./fines.service");
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
    constructor(circulation, fines) {
        this.circulation = circulation;
        this.fines = fines;
    }
    async scan(dto) {
        return this.circulation.scan(dto.code);
    }
    async activeBorrowingForCopy(copyId) {
        return this.circulation.findActiveBorrowingForCopy(copyId);
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
        const borrowingBefore = await this.circulation.findBorrowing(dto.borrowingId);
        const { borrowing, daysLate } = await this.circulation.returnBorrowing(dto.borrowingId, user.userId, dto.returnStatus, dto.returnNotes);
        let lateFine = null;
        // Auto-create fines for late returns or damage/loss
        if (daysLate > 0) {
            const policy = await this.circulation.getLoanPolicy();
            const amount = daysLate * policy.finePerDay;
            if (amount > 0) {
                lateFine = await this.fines.createLateFine(borrowingBefore.studentId, dto.borrowingId, amount, user.userId);
            }
        }
        // Auto-suggest fine for damage/loss (caller decides whether to create it)
        let damageFine = null;
        if (dto.returnStatus === 'damaged' || dto.returnStatus === 'lost') {
            // Fine amount would be determined by FinesService based on fine type
            // For now, just return indicator that a fine should be considered
            damageFine = { suggested: true, reason: dto.returnStatus };
        }
        return { borrowing, daysLate, lateFine, damageFine };
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
    (0, common_1.Get)('book-copies/:copyId/active-borrowing'),
    (0, platform_1.RequirePermission)('library_circulation.return'),
    __param(0, (0, common_1.Param)('copyId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CirculationController.prototype, "activeBorrowingForCopy", null);
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
exports.CirculationController = CirculationController = __decorate([
    (0, common_1.Controller)('api/library-circulation'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [circulation_service_1.CirculationService,
        fines_service_1.FinesService])
], CirculationController);
