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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardController = void 0;
const common_1 = require("@nestjs/common");
const circulation_service_1 = require("./circulation.service");
const fines_service_1 = require("./fines.service");
const platform_1 = require("./platform");
const students_service_1 = require("./students.service");
/** §18's dashboard cards — combines real counts from all three services, no mock data. */
let DashboardController = class DashboardController {
    students;
    circulation;
    fines;
    constructor(students, circulation, fines) {
        this.students = students;
        this.circulation = circulation;
        this.fines = fines;
    }
    async getStats() {
        const [students, copyStats, financeSummary] = await Promise.all([
            this.students.count(),
            this.circulation.getCopyStats(),
            this.fines.getFinanceSummary(),
        ]);
        return {
            students,
            totalCopies: copyStats.totalCopies,
            availableCopies: copyStats.availableCopies,
            borrowedCopies: copyStats.borrowedCopies,
            overdueBorrowings: copyStats.overdueBorrowings,
            unpaidFinesTotal: financeSummary.unpaidTotal,
            paidFinesTotal: financeSummary.paidTotal,
        };
    }
};
exports.DashboardController = DashboardController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('library_circulation.dashboard.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DashboardController.prototype, "getStats", null);
exports.DashboardController = DashboardController = __decorate([
    (0, common_1.Controller)('api/library-circulation/dashboard'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [students_service_1.StudentsService,
        circulation_service_1.CirculationService,
        fines_service_1.FinesService])
], DashboardController);
