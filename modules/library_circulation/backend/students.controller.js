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
const create_student_dto_1 = require("./dto/create-student.dto");
const update_student_dto_1 = require("./dto/update-student.dto");
const platform_1 = require("./platform");
const students_service_1 = require("./students.service");
const fetchStudentState = (prisma, req) => prisma.libraryStudent.findUnique({ where: { id: req.params.id } });
let StudentsController = class StudentsController {
    students;
    constructor(students) {
        this.students = students;
    }
    async list() {
        return this.students.list();
    }
    async findById(id) {
        return this.students.findById(id);
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
    (0, common_1.Get)(':id'),
    (0, platform_1.RequirePermission)('library_circulation.students.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StudentsController.prototype, "findById", null);
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
    __metadata("design:paramtypes", [students_service_1.StudentsService])
], StudentsController);
