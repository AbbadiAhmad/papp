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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var BooksImportService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BooksImportService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const exceljs_1 = __importDefault(require("exceljs"));
const books_import_rules_1 = require("./books-import-rules");
const books_service_1 = require("./books.service");
const MAX_ROWS = 5000;
const FIELD_ORDER = { readingLevel: 'reading_level', pageCount: 'page_count' };
/**
 * Imports the Excel file the books export produces (LIBRARY_CATALOG-D31): preview first (writes nothing), then
 * an all-or-nothing commit — any invalid row stops the whole import, same flow as core's Users import (D42).
 */
let BooksImportService = BooksImportService_1 = class BooksImportService {
    books;
    logger = new common_1.Logger(BooksImportService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(books) {
        this.books = books;
    }
    async onModuleInit() {
        await this.prisma.$connect();
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async parseWorkbook(buffer) {
        const workbook = new exceljs_1.default.Workbook();
        try {
            await workbook.xlsx.load(buffer);
        }
        catch {
            throw new common_1.BadRequestException('The file is not a readable .xlsx workbook');
        }
        const sheet = workbook.worksheets[0];
        if (!sheet)
            throw new common_1.BadRequestException('The workbook has no sheet');
        const columns = new Map();
        sheet.getRow(1).eachCell((cell, col) => {
            const name = this.cellText(cell.value).toLowerCase();
            if (name)
                columns.set(name, col);
        });
        if (!columns.has('title'))
            throw new common_1.BadRequestException('The first row must contain a "title" column (use the file produced by the export)');
        if (sheet.rowCount - 1 > MAX_ROWS)
            throw new common_1.BadRequestException(`At most ${MAX_ROWS} rows can be imported at once`);
        const rows = [];
        for (let r = 2; r <= sheet.rowCount; r += 1) {
            const excelRow = sheet.getRow(r);
            const cells = {};
            let any = false;
            for (const [name, col] of columns) {
                const text = this.cellText(excelRow.getCell(col).value);
                cells[name] = text;
                if (text)
                    any = true;
            }
            if (any)
                rows.push({ row: r, id: (cells.id ?? '').trim(), cells });
        }
        return rows;
    }
    cellText(value) {
        if (value === null || value === undefined)
            return '';
        if (typeof value === 'object') {
            if ('richText' in value)
                return value.richText.map((part) => part.text).join('').trim();
            if ('text' in value && typeof value.text === 'string')
                return value.text.trim();
            if ('result' in value && value.result !== undefined)
                return String(value.result).trim();
            if (value instanceof Date)
                return value.toISOString();
            return '';
        }
        return String(value).trim();
    }
    /** Validates every row against the current catalog; writes nothing. */
    async preview(buffer) {
        const raw = await this.parseWorkbook(buffer);
        const ids = raw.map((r) => r.id).filter((id) => (0, books_import_rules_1.isUuid)(id));
        const existing = ids.length ? await this.prisma.libraryCatalogBook.findMany({ where: { id: { in: ids } } }) : [];
        const byId = new Map(existing.map((book) => [book.id, book]));
        const seen = new Set();
        const plan = raw.map((r) => {
            const base = { row: r.row, id: r.id || null, changes: [] };
            const parsed = (0, books_import_rules_1.toBookValues)(r.cells);
            const title = (r.cells.title ?? '').trim() || null;
            const fail = (error) => ({ ...base, title, action: null, valid: false, error, values: null });
            if ('error' in parsed)
                return fail(parsed.error);
            if (r.id) {
                if (!(0, books_import_rules_1.isUuid)(r.id))
                    return fail('id is not a valid book id (leave it blank to add a new book)');
                if (seen.has(r.id))
                    return fail('this id appears more than once in the file');
                seen.add(r.id);
                const book = byId.get(r.id);
                if (!book)
                    return fail('no book with this id exists');
                const current = {
                    title: book.title,
                    author: book.author,
                    publisher: book.publisher,
                    category: book.category,
                    readingLevel: book.readingLevel,
                    language: book.language,
                    pageCount: book.pageCount,
                };
                const changes = (0, books_import_rules_1.changedFields)(current, parsed.values).map((key) => FIELD_ORDER[key] ?? key);
                return { ...base, title: parsed.values.title, changes, action: changes.length ? 'update' : 'unchanged', valid: true, error: null, values: parsed.values };
            }
            return { ...base, title: parsed.values.title, action: 'create', valid: true, error: null, values: parsed.values };
        });
        const validCount = plan.filter((p) => p.valid).length;
        const report = {
            rows: plan.map(({ values: _values, ...rest }) => rest),
            validCount,
            invalidCount: plan.length - validCount,
            allValid: plan.length > 0 && validCount === plan.length,
        };
        return { report, plan };
    }
    async commit(buffer) {
        const { report, plan } = await this.preview(buffer);
        if (!report.allValid)
            return report;
        let created = 0;
        let updated = 0;
        for (const row of plan) {
            const v = row.values;
            if (row.action === 'update') {
                await this.prisma.libraryCatalogBook.update({
                    where: { id: row.id },
                    data: { title: v.title, author: v.author, publisher: v.publisher, category: v.category, readingLevel: v.readingLevel, language: v.language, pageCount: v.pageCount },
                });
                updated += 1;
            }
            else if (row.action === 'create') {
                // Same rule as the Add Book form: every book comes with its first copy; no code given, so the server numbers it.
                await this.books.create({
                    title: v.title,
                    author: v.author ?? undefined,
                    publisher: v.publisher ?? undefined,
                    category: v.category ?? undefined,
                    readingLevel: v.readingLevel ?? undefined,
                    language: v.language ?? undefined,
                    pageCount: v.pageCount ?? undefined,
                    copy: {},
                });
                created += 1;
            }
        }
        this.logger.log(`books import: ${created} created, ${updated} updated`);
        return { ...report, created, updated };
    }
};
exports.BooksImportService = BooksImportService;
exports.BooksImportService = BooksImportService = BooksImportService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [books_service_1.BooksService])
], BooksImportService);
