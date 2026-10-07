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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudentsExcelService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const argon2 = __importStar(require("argon2"));
const exceljs_1 = __importDefault(require("exceljs"));
const node_crypto_1 = require("node:crypto");
const students_service_1 = require("./students.service");
const READER_ROLE_CODE = 'reader';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Header text (lower-cased, trimmed) -> field. English only; the export writes exactly these. */
const HEADER_ALIASES = {
    code: 'code',
    'reader code': 'code',
    name: 'name',
    email: 'email',
    class: 'className',
    'class name': 'className',
    id: 'externalId',
    'external id': 'externalId',
    externalid: 'externalId',
    department: 'department',
    active: 'isActive',
};
/**
 * Excel import/export of readers (mirrors core's D30/D42 users import:
 * preview writes nothing; commit re-parses the uploaded file, re-validates
 * from scratch and applies everything in ONE transaction, all-or-nothing).
 *
 * Upsert key: `code` when given, else `email`. New readers get an
 * auto-generated code when the Code cell is blank, and a random temporary
 * password that is NOT returned anywhere (it would otherwise land in the
 * audit trail) — the librarian issues a usable one afterwards with
 * "Reset password" in the reader's Edit dialog. Blank cells on an existing
 * reader leave the stored value unchanged.
 */
let StudentsExcelService = class StudentsExcelService {
    students;
    prisma = new client_1.PrismaClient();
    constructor(students) {
        this.students = students;
    }
    async onModuleInit() {
        await this.prisma.$connect();
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    // --- export ---------------------------------------------------------------
    async exportWorkbook() {
        const rows = await this.students.list();
        const workbook = new exceljs_1.default.Workbook();
        const sheet = workbook.addWorksheet('Readers');
        sheet.columns = [
            { header: 'Code', key: 'code', width: 16 },
            { header: 'Name', key: 'name', width: 30 },
            { header: 'Email', key: 'email', width: 32 },
            { header: 'Class', key: 'className', width: 16 },
            { header: 'External ID', key: 'externalId', width: 18 },
            { header: 'Department', key: 'department', width: 20 },
            { header: 'Active', key: 'isActive', width: 10 },
        ];
        sheet.getRow(1).font = { bold: true };
        for (const r of rows) {
            sheet.addRow({
                code: r.code,
                name: r.name ?? '',
                email: r.email ?? '',
                className: r.className ?? '',
                externalId: r.externalId ?? '',
                department: r.department ?? '',
                isActive: r.isActive ? 'yes' : 'no',
            });
        }
        return Buffer.from(await workbook.xlsx.writeBuffer());
    }
    // --- import ---------------------------------------------------------------
    async parseWorkbook(buffer) {
        const workbook = new exceljs_1.default.Workbook();
        try {
            await workbook.xlsx.load(buffer);
        }
        catch {
            throw new common_1.BadRequestException('Could not read the uploaded file as a valid .xlsx workbook');
        }
        const sheet = workbook.worksheets[0];
        if (!sheet)
            throw new common_1.BadRequestException('The workbook has no worksheets');
        const columns = new Map();
        sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
            const field = HEADER_ALIASES[cellText(cell.value).toLowerCase()];
            if (field)
                columns.set(col, field);
        });
        if (!columns.size) {
            throw new common_1.BadRequestException('No recognized columns found in the header row (expected: Code, Name, Email, Class, External ID, Department, Active)');
        }
        const rows = [];
        for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
            const row = sheet.getRow(rowNumber);
            const parsed = {
                row: rowNumber, code: null, name: null, email: null, className: null, externalId: null, department: null, isActive: null,
            };
            let any = false;
            for (const [col, field] of columns) {
                const text = cellText(row.getCell(col).value);
                if (!text)
                    continue;
                any = true;
                if (field === 'isActive') {
                    const flag = parseFlag(text);
                    if (flag === undefined)
                        parsed.isActiveInvalid = true;
                    else
                        parsed.isActive = flag;
                }
                else {
                    parsed[field] = text;
                }
            }
            if (any)
                rows.push(parsed);
        }
        return rows;
    }
    /** Read-only validation (no writes) — also used by commit as its own first step. */
    async validateRows(rows) {
        await this.students.syncReaderProfiles(); // self-registered readers must be matchable too
        const codes = rows.map((r) => r.code).filter((v) => !!v);
        const emails = rows.map((r) => r.email?.toLowerCase()).filter((v) => !!v);
        const [byCode, users] = await Promise.all([
            codes.length ? this.prisma.libraryStudent.findMany({ where: { code: { in: codes } } }) : [],
            emails.length ? this.prisma.user.findMany({ where: { email: { in: emails, mode: 'insensitive' } }, select: { id: true, email: true } }) : [],
        ]);
        const studentByCode = new Map(byCode.map((s) => [s.code, s]));
        const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
        const profiles = users.length ? await this.prisma.libraryStudent.findMany({ where: { userId: { in: users.map((u) => u.id) } } }) : [];
        const studentByUserId = new Map(profiles.map((s) => [s.userId, s]));
        // Codes held by readers OTHER than the one a row targets must be rejected too.
        const seenCodes = new Map();
        const seenEmails = new Map();
        const results = rows.map((row) => {
            const fail = (error) => ({ ...row, valid: false, error, action: null, matchedStudentId: null });
            if (row.isActiveInvalid)
                return fail('Active must be yes/no');
            if (row.email && !EMAIL_RE.test(row.email))
                return fail(`Invalid email "${row.email}"`);
            if (!row.code && !row.email)
                return fail('Each row needs a Code or an Email');
            if (row.code) {
                const first = seenCodes.get(row.code);
                if (first)
                    return fail(`Duplicate code "${row.code}" (also on row ${first})`);
                seenCodes.set(row.code, row.row);
            }
            if (row.email) {
                const key = row.email.toLowerCase();
                const first = seenEmails.get(key);
                if (first)
                    return fail(`Duplicate email "${row.email}" (also on row ${first})`);
                seenEmails.set(key, row.row);
            }
            const codeMatch = row.code ? studentByCode.get(row.code) : undefined;
            const emailUser = row.email ? userByEmail.get(row.email.toLowerCase()) : undefined;
            const emailMatch = emailUser ? studentByUserId.get(emailUser.id) : undefined;
            if (emailUser && !emailMatch)
                return fail(`"${row.email}" belongs to an account that is not a reader — manage it from Users`);
            if (codeMatch && emailMatch && codeMatch.id !== emailMatch.id) {
                return fail(`Code "${row.code}" and email "${row.email}" belong to two different readers`);
            }
            const matched = codeMatch ?? emailMatch;
            if (matched)
                return { ...row, valid: true, error: null, action: 'update', matchedStudentId: matched.id };
            // Creating: a lookup by code alone that found nothing is a new reader, which needs name + email.
            if (!row.name)
                return fail('Name is required for a new reader');
            if (!row.email)
                return fail('Email is required for a new reader');
            return { ...row, valid: true, error: null, action: 'create', matchedStudentId: null };
        });
        const validCount = results.filter((r) => r.valid).length;
        return { rows: results, validCount, invalidCount: results.length - validCount, allValid: results.length > 0 && validCount === results.length };
    }
    /** Re-parses and re-validates the uploaded file, then applies it all-or-nothing. A report with `allValid: false` means nothing was written. */
    async commit(buffer, importedBy) {
        const report = await this.validateRows(await this.parseWorkbook(buffer));
        if (!report.allValid)
            return report;
        const readerRole = await this.prisma.role.findUnique({ where: { code: READER_ROLE_CODE } });
        if (!readerRole)
            throw new common_1.BadRequestException(`The "${READER_ROLE_CODE}" role does not exist — cannot create reader accounts`);
        // Hash outside the transaction — argon2 is deliberately slow.
        const creates = report.rows.filter((r) => r.action === 'create');
        const hashes = await Promise.all(creates.map(() => argon2.hash((0, node_crypto_1.randomBytes)(18).toString('base64url'), { type: argon2.argon2id })));
        try {
            await this.prisma.$transaction(async (tx) => {
                let createIndex = 0;
                for (const row of report.rows) {
                    if (row.action === 'update') {
                        const student = await tx.libraryStudent.findUniqueOrThrow({ where: { id: row.matchedStudentId } });
                        const userData = {
                            name: row.name ?? undefined,
                            email: row.email ?? undefined,
                            externalId: row.externalId ?? undefined,
                            department: row.department ?? undefined,
                            isActive: row.isActive ?? undefined,
                        };
                        if (Object.values(userData).some((v) => v !== undefined)) {
                            await tx.user.update({ where: { id: student.userId }, data: userData });
                        }
                        if (row.code)
                            await this.students.reconcileCodeSequence(tx, row.code);
                        await tx.libraryStudent.update({ where: { id: student.id }, data: { code: row.code ?? undefined, className: row.className ?? undefined } });
                    }
                    else {
                        const code = row.code ?? (await this.students.allocateCode(tx));
                        if (row.code)
                            await this.students.reconcileCodeSequence(tx, row.code);
                        const user = await tx.user.create({
                            data: {
                                email: row.email,
                                name: row.name,
                                externalId: row.externalId ?? undefined,
                                department: row.department ?? undefined,
                                isActive: row.isActive ?? true,
                                passwordHash: hashes[createIndex++],
                                mustChangePassword: true,
                                createdBy: importedBy,
                            },
                        });
                        await tx.userRole.create({ data: { userId: user.id, roleId: readerRole.id, assignedBy: importedBy } });
                        await tx.libraryStudent.create({ data: { userId: user.id, code, className: row.className ?? undefined } });
                    }
                }
            }, { timeout: 120_000 });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const target = error.meta?.target?.join(', ') ?? 'field';
                throw new common_1.ConflictException(`Import rejected — a reader or user with this ${target} already exists (nothing was imported)`);
            }
            throw error;
        }
        return report;
    }
};
exports.StudentsExcelService = StudentsExcelService;
exports.StudentsExcelService = StudentsExcelService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [students_service_1.StudentsService])
], StudentsExcelService);
/** ExcelJS cell values may be rich objects (hyperlink emails, formulas, rich text) — flatten to trimmed text. */
function cellText(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'object') {
        if ('text' in value && value.text !== undefined)
            return cellText(value.text);
        if ('richText' in value)
            return value.richText.map((p) => p.text).join('').trim();
        if ('result' in value && value.result !== undefined)
            return cellText(value.result);
        if (value instanceof Date)
            return value.toISOString().slice(0, 10);
        return '';
    }
    return String(value).trim();
}
function parseFlag(text) {
    const v = text.toLowerCase();
    if (['yes', 'y', 'true', '1', 'active', 'نعم'].includes(v))
        return true;
    if (['no', 'n', 'false', '0', 'inactive', 'لا'].includes(v))
        return false;
    return undefined;
}
