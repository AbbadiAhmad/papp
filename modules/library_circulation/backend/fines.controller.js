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
exports.FinesController = void 0;
const common_1 = require("@nestjs/common");
const create_fine_dto_1 = require("./dto/create-fine.dto");
const list_fines_dto_1 = require("./dto/list-fines.dto");
const list_payments_dto_1 = require("./dto/list-payments.dto");
const record_payment_dto_1 = require("./dto/record-payment.dto");
const update_fine_dto_1 = require("./dto/update-fine.dto");
const fines_service_1 = require("./fines.service");
const platform_1 = require("./platform");
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fetchFineState = (prisma, req) => prisma.libraryFine.findUnique({ where: { id: req.params.id } });
let FinesController = class FinesController {
    fines;
    constructor(fines) {
        this.fines = fines;
    }
    async listFineTypes() {
        return this.fines.listFineTypes();
    }
    async list(filter) {
        return this.fines.list(filter);
    }
    async findById(id) {
        return this.fines.findById(id);
    }
    async create(dto, user) {
        return this.fines.create(dto, user.userId);
    }
    /** Editable while unpaid/partially_paid — same permission that creates a fine (§ AskUserQuestion: pre-payment edit gate). */
    async update(id, dto) {
        return this.fines.update(id, dto, false);
    }
    /** Editing a fine that's already fully paid — a distinct, more privileged permission than the pre-payment edit above. */
    async updateAfterPayment(id, dto) {
        return this.fines.update(id, dto, true);
    }
    async waive(id) {
        return this.fines.waive(id);
    }
    async recordPayment(id, dto, user) {
        return this.fines.recordPayment(id, dto.amount, user.userId, dto.paymentMethod);
    }
    async listTransactions() {
        return this.fines.listTransactions();
    }
    async exportPayments(filter, res) {
        const buffer = await this.fines.exportPaymentsWorkbook(filter);
        res.set({
            'Content-Type': XLSX_CONTENT_TYPE,
            'Content-Disposition': 'attachment; filename="library-circulation-payments-export.xlsx"',
        });
        res.send(buffer);
    }
    async listPayments(filter) {
        return this.fines.listPayments(filter);
    }
};
exports.FinesController = FinesController;
__decorate([
    (0, common_1.Get)('fine-types'),
    (0, platform_1.RequirePermission)('library_circulation.fines.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "listFineTypes", null);
__decorate([
    (0, common_1.Get)('fines'),
    (0, platform_1.RequirePermission)('library_circulation.fines.view'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_fines_dto_1.ListFinesDto]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('fines/:id'),
    (0, platform_1.RequirePermission)('library_circulation.fines.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "findById", null);
__decorate([
    (0, common_1.Post)('fines'),
    (0, platform_1.RequirePermission)('library_circulation.fines.record'),
    (0, platform_1.Audit)({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_fine_dto_1.CreateFineDto, Object]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)('fines/:id'),
    (0, platform_1.RequirePermission)('library_circulation.fines.record'),
    (0, platform_1.Audit)({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'update', fetchState: fetchFineState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_fine_dto_1.UpdateFineDto]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)('fines/:id/after-payment'),
    (0, platform_1.RequirePermission)('library_circulation.fines.update_after_payment'),
    (0, platform_1.Audit)({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'update', fetchState: fetchFineState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_fine_dto_1.UpdateFineDto]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "updateAfterPayment", null);
__decorate([
    (0, common_1.Post)('fines/:id/waive'),
    (0, platform_1.RequirePermission)('library_circulation.fines.waive'),
    (0, platform_1.Audit)({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'update', fetchState: fetchFineState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "waive", null);
__decorate([
    (0, common_1.Post)('fines/:id/payments'),
    (0, platform_1.RequirePermission)('library_circulation.finance.record_payment'),
    (0, platform_1.Audit)({ category: 'library_circulation.finance', entityType: 'LibraryPayment', action: 'create' }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, record_payment_dto_1.RecordPaymentDto, Object]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "recordPayment", null);
__decorate([
    (0, common_1.Get)('finance/transactions'),
    (0, platform_1.RequirePermission)('library_circulation.finance.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "listTransactions", null);
__decorate([
    (0, common_1.Get)('finance/payments/export'),
    (0, platform_1.RequirePermission)('library_circulation.finance.view'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_payments_dto_1.ListPaymentsDto, Object]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "exportPayments", null);
__decorate([
    (0, common_1.Get)('finance/payments'),
    (0, platform_1.RequirePermission)('library_circulation.finance.view'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [list_payments_dto_1.ListPaymentsDto]),
    __metadata("design:returntype", Promise)
], FinesController.prototype, "listPayments", null);
exports.FinesController = FinesController = __decorate([
    (0, common_1.Controller)('api/library-circulation'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [fines_service_1.FinesService])
], FinesController);
