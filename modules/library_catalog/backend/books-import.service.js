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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BooksImportService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const exceljs_1 = __importDefault(require("exceljs"));
const books_import_rules_1 = require("./books-import-rules");
const book_files_service_1 = require("./book-files.service");
const books_service_1 = require("./books.service");
const MAX_ROWS = 20000;
const KNOWN_COLUMNS = new Set([...books_import_rules_1.BOOK_COLUMNS, ...books_import_rules_1.COPY_COLUMNS]);
/**
 * Imports the one-row-per-copy Excel file the export produces (LIBRARY_CATALOG-D32). Two steps:
 *  - `preview`: groups rows into books, compares with the catalog and flags inconsistencies; writes nothing.
 *  - `commit`: the same file plus the user's decisions (which books/copies to apply, and the final text of each
 *    field they chose to write). The plan is recomputed from the file, every final value is validated again, and
 *    everything is written in ONE transaction — a failure leaves the catalog untouched.
 */
let BooksImportService = class BooksImportService {
    books;
    files;
    prisma = new client_1.PrismaClient();
    constructor(books, files) {
        this.books = books;
        this.files = files;
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
            if (KNOWN_COLUMNS.has(name))
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
                const value = excelRow.getCell(col).value;
                const cellText = name === 'copy_acquisition_date' && value instanceof Date ? value.toISOString().slice(0, 10) : this.cellText(value);
                cells[name] = cellText;
                if (cellText)
                    any = true;
            }
            if (any)
                rows.push({ row: r, cells });
        }
        return rows;
    }
    cellText(value) {
        if (value === null || value === undefined)
            return '';
        if (value instanceof Date)
            return value.toISOString();
        if (typeof value === 'object') {
            if ('richText' in value)
                return value.richText.map((part) => part.text).join('').trim();
            if ('text' in value && typeof value.text === 'string')
                return value.text.trim();
            if ('result' in value && value.result !== undefined)
                return String(value.result).trim();
            return '';
        }
        return String(value).trim();
    }
    async snapshot() {
        const [books, copies] = await Promise.all([
            this.prisma.libraryCatalogBook.findMany({
                select: { id: true, title: true, author: true, publisher: true, category: true, readingLevel: true, language: true, description: true, pageCount: true },
            }),
            this.prisma.libraryCatalogBookCopy.findMany({ select: { id: true, bookId: true, qrCode: true, status: true, condition: true, location: true, acquisitionDate: true } }),
        ]);
        return {
            books,
            copies: copies.map((c) => ({ ...c, acquisitionDate: c.acquisitionDate ? c.acquisitionDate.toISOString().slice(0, 10) : null })),
        };
    }
    report(plans) {
        const issues = plans.flatMap((b) => [...b.issues, ...b.copies.flatMap((c) => c.issues)]);
        return {
            books: plans,
            errorCount: issues.filter((i) => i.level === 'error').length,
            warningCount: issues.filter((i) => i.level === 'warning').length,
        };
    }
    /** Validates and compares only — writes nothing. */
    async preview(buffer) {
        return this.report((0, books_import_rules_1.planImport)(await this.parseWorkbook(buffer), await this.snapshot()));
    }
    async commit(buffer, decisions) {
        const plans = (0, books_import_rules_1.planImport)(await this.parseWorkbook(buffer), await this.snapshot());
        const renamed = [];
        const result = { booksCreated: 0, booksUpdated: 0, copiesCreated: 0, copiesUpdated: 0, skipped: 0 };
        // Only the cells the user ticked are written; the rest stay as stored (update) or as in the file (create).
        const merged = (base, decision, allowed, locked) => {
            const out = { ...base };
            for (const [field, value] of Object.entries(decision.fields ?? {})) {
                if (allowed.includes(field) && !locked.includes(field))
                    out[field] = String(value ?? '').trim();
            }
            return out;
        };
        try {
            await this.prisma.$transaction(async (tx) => {
                for (const plan of plans) {
                    const bookDecision = decisions.books?.[plan.key];
                    let bookId = plan.bookId;
                    if (bookDecision?.apply && plan.action !== 'unchanged') {
                        if (plan.action === 'error')
                            throw new common_1.BadRequestException(`"${plan.title ?? `row ${plan.rows[0]}`}" has errors and cannot be imported`);
                        const cells = plan.action === 'create' ? merged(plan.incoming, bookDecision, books_import_rules_1.BOOK_FIELDS, []) : merged(plan.current, bookDecision, books_import_rules_1.BOOK_FIELDS, []);
                        const parsed = (0, books_import_rules_1.toBookValues)(cells);
                        if ('error' in parsed)
                            throw new common_1.BadRequestException(`"${plan.title ?? `row ${plan.rows[0]}`}": ${parsed.error}`);
                        const data = parsed.values;
                        if (plan.action === 'create') {
                            bookId = (await tx.libraryCatalogBook.create({ data })).id;
                            result.booksCreated += 1;
                        }
                        else {
                            await tx.libraryCatalogBook.update({ where: { id: plan.bookId }, data });
                            renamed.push(plan.bookId);
                            result.booksUpdated += 1;
                        }
                    }
                    else if (plan.action === 'create' || plan.action === 'update' || plan.action === 'error') {
                        if (plan.action !== 'update')
                            result.skipped += 1;
                    }
                    for (const copyPlan of plan.copies) {
                        const decision = bookDecision?.copies?.[copyPlan.key];
                        if (!decision?.apply || copyPlan.action === 'unchanged')
                            continue;
                        if (copyPlan.action === 'error')
                            throw new common_1.BadRequestException(`Row ${copyPlan.rows[0]} (copy) has errors and cannot be imported`);
                        if (!bookId) {
                            result.skipped += 1; // its new book was not applied, so there is nothing to attach the copy to
                            continue;
                        }
                        const locked = copyPlan.fields.filter((f) => f.locked).map((f) => f.field);
                        let existing = copyPlan.copyId ? await tx.libraryCatalogBookCopy.findUnique({ where: { id: copyPlan.copyId } }) : null;
                        const currentCells = existing
                            ? {
                                copy_code: existing.qrCode,
                                copy_status: existing.status,
                                copy_condition: existing.condition ?? '',
                                copy_location: existing.location ?? '',
                                copy_acquisition_date: existing.acquisitionDate ? existing.acquisitionDate.toISOString().slice(0, 10) : '',
                            }
                            : null;
                        const cells = merged(currentCells ?? copyPlan.incoming, decision, books_import_rules_1.COPY_FIELDS, locked);
                        const parsed = (0, books_import_rules_1.toCopyValues)(cells, existing?.status ?? 'available');
                        if ('error' in parsed)
                            throw new common_1.BadRequestException(`Row ${copyPlan.rows[0]} (copy): ${parsed.error}`);
                        const v = parsed.values;
                        if (!existing) {
                            const qrCode = v.code ?? (await this.books.nextCopyCode(tx));
                            if (v.code)
                                await this.books.reconcileCopyCodeSequence(tx, v.code);
                            await tx.libraryCatalogBookCopy.create({
                                data: {
                                    bookId,
                                    qrCode,
                                    status: v.status,
                                    condition: v.condition,
                                    location: v.location,
                                    acquisitionDate: v.acquisitionDate ? new Date(v.acquisitionDate) : null,
                                },
                            });
                            result.copiesCreated += 1;
                        }
                        else {
                            const code = v.code ?? existing.qrCode;
                            const changes = {};
                            if (v.status !== existing.status)
                                changes.status = { before: existing.status, after: v.status };
                            if (v.condition !== existing.condition)
                                changes.condition = { before: existing.condition, after: v.condition };
                            if (v.location !== existing.location)
                                changes.location = { before: existing.location, after: v.location };
                            if (code !== existing.qrCode)
                                changes.qrCode = { before: existing.qrCode, after: code };
                            const before = existing.acquisitionDate ? existing.acquisitionDate.toISOString().slice(0, 10) : null;
                            if (v.acquisitionDate !== before)
                                changes.acquisitionDate = { before, after: v.acquisitionDate };
                            const history = (Array.isArray(existing.history) ? existing.history : []);
                            const nextHistory = Object.keys(changes).length ? [...history, { timestamp: new Date().toISOString(), changes, source: 'import' }].slice(-100) : history;
                            if (code !== existing.qrCode)
                                await this.books.reconcileCopyCodeSequence(tx, code);
                            existing = await tx.libraryCatalogBookCopy.update({
                                where: { id: existing.id },
                                data: {
                                    qrCode: code,
                                    status: v.status,
                                    condition: v.condition,
                                    location: v.location,
                                    acquisitionDate: v.acquisitionDate ? new Date(v.acquisitionDate) : null,
                                    history: nextHistory,
                                },
                            });
                            result.copiesUpdated += 1;
                        }
                    }
                }
            }, { timeout: 120_000, maxWait: 10_000 });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new common_1.ConflictException('A copy code in the file is already used by another copy — nothing was imported. Run the preview again.');
            }
            throw error;
        }
        for (const id of renamed)
            await this.files.writeInfo(id); // keeps each book folder's info.txt (title/author) in step
        return { ...this.report(plans), result };
    }
};
exports.BooksImportService = BooksImportService;
exports.BooksImportService = BooksImportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [books_service_1.BooksService,
        book_files_service_1.BookFilesService])
], BooksImportService);
