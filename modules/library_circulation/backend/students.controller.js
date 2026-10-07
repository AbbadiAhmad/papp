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
exports.StudentsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const create_student_dto_1 = require("./dto/create-student.dto");
const update_student_dto_1 = require("./dto/update-student.dto");
const platform_1 = require("./platform");
const students_excel_service_1 = require("./students-excel.service");
const students_service_1 = require("./students.service");
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Profile + the linked account's editable fields (never the password hash) — what the audit trail records for a reader. */
const fetchStudentState = async (prisma, req) => {
    const student = await prisma.libraryStudent.findUnique({ where: { id: req.params.id } });
    if (!student)
        return null;
    const user = await prisma.user.findUnique({
        where: { id: student.userId },
        select: { name: true, email: true, externalId: true, department: true, isActive: true, mustChangePassword: true },
    });
    return { ...student, ...user };
};
let StudentsController = class StudentsController {
    students;
    excel;
    constructor(students, excel) {
        this.students = students;
        this.excel = excel;
    }
    async list() {
        return this.students.list();
    }
    /**
     * Searchable reader picker (Fines page's [Create Fine] dialog, Scan page's
     * search-by-name lookup) — registered BEFORE `:id` so Express never treats
     * "search" as an id (same lesson as every other module's own docblock on
     * this, e.g. library_catalog's books.controller.ts).
     */
    async search(q) {
        return this.students.search(q ?? '');
    }
    /** Suggested next reader code for the Add form (read-only peek; same pattern as library_catalog's `copies/next-code`). Before `:id` for the usual Express ordering reason. */
    async peekNextCode() {
        return { code: await this.students.peekNextCode() };
    }
    async export(res) {
        const buffer = await this.excel.exportWorkbook();
        res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="library-readers-export.xlsx"' });
        res.send(buffer);
    }
    /** Validates only — writes nothing (same preview/commit split as core's users import, D42). */
    async importPreview(file) {
        if (!file)
            throw new common_1.BadRequestException('No file uploaded (expected multipart field "file")');
        return this.excel.validateRows(await this.excel.parseWorkbook(file.buffer));
    }
    async importCommit(file, user) {
        if (!file)
            throw new common_1.BadRequestException('No file uploaded (expected multipart field "file")');
        return this.excel.commit(file.buffer, user.userId);
    }
    async findById(id) {
        return this.students.findById(id);
    }
    /** §3.2 "Reading History" tab — every borrowing ever, never just the active ones. */
    async readingHistory(id) {
        return this.students.getReadingHistory(id);
    }
    /** §3.3 "Actions" tab — audit trail of operations on this reader's own account row. */
    async actionHistory(id) {
        return this.students.getActionHistory(id);
    }
    async create(dto, user) {
        return this.students.create(dto, user.userId);
    }
    async update(id, dto) {
        return this.students.update(id, dto);
    }
    async remove(id) {
        await this.students.remove(id);
    }
};
exports.StudentsController = StudentsController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('library_circulation.students.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('search'),
    (0, platform_1.RequirePermission)('library_circulation.students.view'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('next-code'),
    (0, platform_1.RequirePermission)('library_circulation.students.create'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "peekNextCode", null);
__decorate([
    (0, common_1.Get)('export'),
    (0, platform_1.RequirePermission)('library_circulation.students.export'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "export", null);
__decorate([
    (0, common_1.Post)('import/preview'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, platform_1.RequirePermission)('library_circulation.students.import'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "importPreview", null);
__decorate([
    (0, common_1.Post)('import'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, platform_1.RequirePermission)('library_circulation.students.import'),
    (0, platform_1.Audit)({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'import' }),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "importCommit", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.RequirePermission)('library_circulation.students.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "findById", null);
__decorate([
    (0, common_1.Get)(':id/reading-history'),
    (0, platform_1.RequirePermission)('library_circulation.students.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "readingHistory", null);
__decorate([
    (0, common_1.Get)(':id/action-history'),
    (0, platform_1.RequirePermission)('library_circulation.students.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "actionHistory", null);
__decorate([
    (0, common_1.Post)(),
    (0, platform_1.RequirePermission)('library_circulation.students.create'),
    (0, platform_1.Audit)({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_student_dto_1.CreateStudentDto, Object]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, platform_1.RequirePermission)('library_circulation.students.update'),
    (0, platform_1.Audit)({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'update', fetchState: fetchStudentState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_student_dto_1.UpdateStudentDto]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('library_circulation.students.delete'),
    (0, platform_1.Audit)({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'delete', fetchState: fetchStudentState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "remove", null);
exports.StudentsController = StudentsController = __decorate([
    (0, common_1.Controller)('api/library-circulation/students'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [students_service_1.StudentsService,
        students_excel_service_1.StudentsExcelService])
], StudentsController);
