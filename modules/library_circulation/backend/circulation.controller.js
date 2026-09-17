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
    async borrow(dto, user) {
        return this.circulation.borrow(dto.studentId, dto.bookCopyId, user.userId);
    }
    async returnBorrowing(dto, user) {
        const borrowingBefore = await this.circulation.findBorrowing(dto.borrowingId);
        const { borrowing, daysLate } = await this.circulation.returnBorrowing(dto.borrowingId, user.userId);
        let lateFine = null;
        if (daysLate > 0) {
            const policy = await this.circulation.getLoanPolicy();
            const amount = daysLate * policy.finePerDay;
            if (amount > 0) {
                lateFine = await this.fines.createLateFine(borrowingBefore.studentId, dto.borrowingId, amount, user.userId);
            }
        }
        return { borrowing, daysLate, lateFine };
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
