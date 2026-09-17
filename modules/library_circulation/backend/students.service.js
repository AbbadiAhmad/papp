"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var StudentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudentsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const argon2 = __importStar(require("argon2"));
const node_crypto_1 = require("node:crypto");
const READER_ROLE_CODE = 'reader';
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
/**
 * A "student" (§2) is a real, login-capable platform User with the `reader`
 * role (root D41) — this service creates BOTH the user account and the
 * library-specific profile row in one transaction (the librarian's actual
 * workflow), reusing the same argon2id hashing (root ASSUMPTIONS.md A11)
 * every other password in this platform uses. No password is ever typed by
 * the librarian: a random one is generated, hashed, and returned exactly
 * once in the create response with `mustChangePassword: true` set — same
 * "admin sets an initial credential, the real owner picks their own next
 * login" pattern core's own admin-created-user flow already uses.
 *
 * Own dedicated `PrismaClient` (D57 pattern, same as every other module) —
 * `User`/`Role`/`UserRole` are part of the one shared generated client even
 * though they're core tables, so no cross-module service import is needed
 * for this.
 */
let StudentsService = StudentsService_1 = class StudentsService {
    logger = new common_1.Logger(StudentsService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('library_circulation (students) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async list() {
        return this.prisma.libraryStudent.findMany({ orderBy: { createdAt: 'desc' } });
    }
    async findById(id) {
        const student = await this.getOrThrow(id);
        const [activeBorrowings, openFines] = await Promise.all([
            this.prisma.libraryBorrowing.findMany({
                where: { studentId: id, status: { in: ['active', 'overdue'] } },
                orderBy: { borrowedAt: 'desc' },
            }),
            this.prisma.libraryFine.findMany({
                where: { studentId: id, status: { in: ['unpaid', 'partially_paid'] } },
                orderBy: { createdAt: 'desc' },
            }),
        ]);
        return { ...student, activeBorrowings, openFines };
    }
    async create(dto, createdBy) {
        const temporaryPassword = (0, node_crypto_1.randomBytes)(9).toString('base64url'); // ~12 chars, URL-safe
        const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
        const readerRole = await this.prisma.role.findUnique({ where: { code: READER_ROLE_CODE } });
        if (!readerRole) {
            throw new common_1.BadRequestException(`The "${READER_ROLE_CODE}" role does not exist — cannot create a student account`);
        }
        try {
            const student = await this.prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        email: dto.email,
                        name: dto.name,
                        passwordHash,
                        mustChangePassword: true,
                        createdBy,
                    },
                });
                await tx.userRole.create({ data: { userId: user.id, roleId: readerRole.id, assignedBy: createdBy } });
                const created = await tx.libraryStudent.create({
                    data: {
                        userId: user.id,
                        code: dto.code,
                        className: dto.className,
                        academicYearId: dto.academicYearId,
                    },
                });
                return { ...created, name: user.name, email: user.email };
            });
            return { ...student, temporaryPassword };
        }
        catch (error) {
            throw this.translateUniqueConstraintError(error);
        }
    }
    async update(id, dto) {
        await this.getOrThrow(id);
        try {
            return await this.prisma.libraryStudent.update({
                where: { id },
                data: { code: dto.code, className: dto.className, academicYearId: dto.academicYearId },
            });
        }
        catch (error) {
            throw this.translateUniqueConstraintError(error);
        }
    }
    /** §22: a student with borrowing history can never be deleted. */
    async remove(id) {
        await this.getOrThrow(id);
        const historyCount = await this.prisma.libraryBorrowing.count({ where: { studentId: id } });
        if (historyCount > 0) {
            throw new common_1.ConflictException('This student has borrowing history and cannot be deleted (§22 — history is permanent).');
        }
        await this.prisma.libraryStudent.delete({ where: { id } });
    }
    async findByCode(code) {
        const student = await this.prisma.libraryStudent.findUnique({ where: { code } });
        if (!student) {
            throw new common_1.NotFoundException(`No student found for code "${code}"`);
        }
        return student;
    }
    async countActiveBorrowings(studentId) {
        return this.prisma.libraryBorrowing.count({ where: { studentId, status: { in: ['active', 'overdue'] } } });
    }
    // --- internals -----------------------------------------------------------
    async getOrThrow(id) {
        const student = await this.prisma.libraryStudent.findUnique({ where: { id } });
        if (!student) {
            throw new common_1.NotFoundException('Student not found');
        }
        return student;
    }
    translateUniqueConstraintError(error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
            const target = error.meta?.target?.join(', ') ?? 'field';
            return new common_1.ConflictException(`A student or user with this ${target} already exists`);
        }
        return error;
    }
};
exports.StudentsService = StudentsService;
exports.StudentsService = StudentsService = StudentsService_1 = __decorate([
    (0, common_1.Injectable)()
], StudentsService);
