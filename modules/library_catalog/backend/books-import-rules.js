"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.copyToCells = exports.bookToCells = exports.isUuid = exports.COPY_STATUSES = exports.withoutNotes = exports.NOTE_FIELDS = exports.COPY_FIELDS = exports.BOOK_FIELDS = exports.COPY_COLUMNS = exports.BOOK_COLUMNS = void 0;
exports.toBookValues = toBookValues;
exports.toCopyValues = toCopyValues;
exports.planImport = planImport;
/**
 * Pure rules for the books Excel export/import (LIBRARY_CATALOG-D31, reworked in D32). Framework-free so the
 * service and the unit tests share it.
 *
 * File format: ONE ROW PER COPY. Every row carries the book's data followed by that copy's data; a book with
 * several copies repeats its book columns on each row, a book with no copies has one row with blank copy
 * columns. `planImport` groups rows into books, compares them with the catalog and returns, for every book and
 * copy, what would be created/updated, the field-by-field differences (current vs incoming) and any
 * inconsistencies — it never writes anything. The user then decides what to apply (see the service).
 */
exports.BOOK_COLUMNS = ['id', 'title', 'author', 'publisher', 'category', 'reading_level', 'language', 'description', 'page_count', 'book_note'];
exports.COPY_COLUMNS = ['copy_id', 'copy_code', 'copy_status', 'copy_condition', 'copy_location', 'copy_acquisition_date', 'copy_note'];
/** Book fields a user can change through the import (the id never changes). */
exports.BOOK_FIELDS = ['title', 'author', 'publisher', 'category', 'reading_level', 'language', 'description', 'page_count', 'book_note'];
exports.COPY_FIELDS = ['copy_code', 'copy_status', 'copy_condition', 'copy_location', 'copy_acquisition_date', 'copy_note'];
/** The internal-note columns (LIBRARY_CATALOG-D35): only read, compared and written for a caller who may see notes. */
exports.NOTE_FIELDS = ['book_note', 'copy_note'];
const withoutNotes = (fields) => fields.filter((f) => !exports.NOTE_FIELDS.includes(f));
exports.withoutNotes = withoutNotes;
exports.COPY_STATUSES = ['available', 'borrowed', 'lost', 'damaged', 'maintenance', 'reserved'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID.test(value);
exports.isUuid = isUuid;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (value) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const text = (value) => (value ?? '').trim();
const orNull = (value) => (text(value) ? text(value) : null);
function toBookValues(cells) {
    const title = text(cells.title);
    if (!title)
        return { error: 'title is required' };
    let pageCount = null;
    const rawPages = text(cells.page_count);
    if (rawPages) {
        const parsed = Number(rawPages);
        if (!Number.isInteger(parsed) || parsed < 1)
            return { error: 'page_count must be a whole number of at least 1' };
        pageCount = parsed;
    }
    return {
        values: {
            title,
            author: orNull(cells.author),
            publisher: orNull(cells.publisher),
            category: orNull(cells.category),
            readingLevel: orNull(cells.reading_level),
            language: orNull(cells.language),
            description: orNull(cells.description),
            pageCount,
            internalNote: orNull(cells.book_note),
        },
    };
}
/** `blankStatus` is what an empty status cell means: 'available' for a new copy, the current status for an existing one. */
function toCopyValues(cells, blankStatus) {
    const status = text(cells.copy_status).toLowerCase() || blankStatus;
    if (!exports.COPY_STATUSES.includes(status))
        return { error: `copy_status "${cells.copy_status}" is not one of ${exports.COPY_STATUSES.join(', ')}` };
    const date = text(cells.copy_acquisition_date);
    if (date && (!DATE.test(date) || Number.isNaN(new Date(date).getTime())))
        return { error: 'copy_acquisition_date must be a date written YYYY-MM-DD' };
    return { values: { code: orNull(cells.copy_code), status, condition: orNull(cells.copy_condition), location: orNull(cells.copy_location), acquisitionDate: date || null, internalNote: orNull(cells.copy_note) } };
}
const bookToCells = (book) => ({
    title: book.title,
    author: book.author ?? '',
    publisher: book.publisher ?? '',
    category: book.category ?? '',
    reading_level: book.readingLevel ?? '',
    language: book.language ?? '',
    description: book.description ?? '',
    page_count: book.pageCount == null ? '' : String(book.pageCount),
    book_note: book.internalNote ?? '',
});
exports.bookToCells = bookToCells;
const copyToCells = (copy) => ({
    copy_code: copy.qrCode,
    copy_status: copy.status,
    copy_condition: copy.condition ?? '',
    copy_location: copy.location ?? '',
    copy_acquisition_date: copy.acquisitionDate ?? '',
    copy_note: copy.internalNote ?? '',
});
exports.copyToCells = copyToCells;
const hasCopyData = (cells) => exports.COPY_COLUMNS.some((c) => text(cells[c]));
function diffFields(fields, current, incoming, locked = []) {
    return fields.map((field) => {
        const before = current ? orNull(current[field]) : null;
        const after = orNull(incoming[field]);
        return { field, current: before, incoming: after, differs: current ? before !== after : after !== null, locked: locked.includes(field) };
    });
}
/** Groups the file's rows into books and compares everything with the catalog. Pure: writes nothing. */
function planImport(rows, db, options = { notes: true }) {
    // A caller who may not see internal notes neither sees, compares nor changes them.
    const bookFields = options.notes ? exports.BOOK_FIELDS : (0, exports.withoutNotes)(exports.BOOK_FIELDS);
    const copyFields = options.notes ? exports.COPY_FIELDS : (0, exports.withoutNotes)(exports.COPY_FIELDS);
    const booksById = new Map(db.books.map((b) => [b.id.toLowerCase(), b]));
    const copiesById = new Map(db.copies.map((c) => [c.id.toLowerCase(), c]));
    const copiesByCode = new Map(db.copies.map((c) => [c.qrCode, c]));
    const bookTitleById = new Map(db.books.map((b) => [b.id, b.title]));
    const copiesOfBook = new Map();
    for (const c of db.copies)
        copiesOfBook.set(c.bookId, [...(copiesOfBook.get(c.bookId) ?? []), c]);
    const similar = new Map();
    for (const b of db.books)
        similar.set(`${norm(b.title)}|${norm(b.author)}|${norm(b.publisher)}`, b);
    const groups = new Map();
    for (const r of rows) {
        const id = text(r.cells.id).toLowerCase();
        const key = id ? `id:${id}` : `new:${norm(r.cells.title)}|${norm(r.cells.author)}|${norm(r.cells.publisher)}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const seenCopyIds = new Map();
    const seenCodes = new Map();
    const plans = [];
    let bookIndex = 0;
    for (const [groupKey, groupRows] of groups) {
        bookIndex += 1;
        const key = `b${bookIndex}`;
        const first = groupRows[0];
        const issues = [];
        const incoming = {};
        for (const f of bookFields)
            incoming[f] = text(first.cells[f]);
        // The same book on several rows must agree; if it doesn't, the first row wins and the user is told.
        for (const f of bookFields) {
            const clashing = groupRows.filter((r) => norm(r.cells[f]) !== norm(first.cells[f]));
            if (clashing.length) {
                issues.push({ level: 'warning', message: `${f} differs between rows ${[first.row, ...clashing.map((r) => r.row)].join(', ')} of the same book; the value from row ${first.row} is used — edit it below if needed` });
            }
        }
        const rawId = text(first.cells.id);
        let dbBook;
        let action = 'create';
        if (groupKey.startsWith('id:')) {
            if (!(0, exports.isUuid)(rawId)) {
                issues.push({ level: 'error', message: 'id is not a valid book id (leave it blank to add a new book)' });
                action = 'error';
            }
            else {
                dbBook = booksById.get(rawId.toLowerCase());
                if (!dbBook) {
                    issues.push({ level: 'error', message: 'no book with this id exists (leave id blank to add it as a new book)' });
                    action = 'error';
                }
            }
        }
        const parsed = toBookValues(incoming);
        if ('error' in parsed) {
            issues.push({ level: 'error', message: parsed.error });
            action = 'error';
        }
        if (!rawId && 'values' in parsed) {
            const twin = similar.get(`${norm(parsed.values.title)}|${norm(parsed.values.author)}|${norm(parsed.values.publisher)}`);
            if (twin)
                issues.push({ level: 'warning', message: `a book with the same title, author and publisher already exists (id ${twin.id}); importing would create a duplicate — put its id in the id column to update it instead` });
        }
        const current = dbBook ? (0, exports.bookToCells)(dbBook) : null;
        const fields = diffFields(bookFields, current, incoming);
        if (action !== 'error')
            action = dbBook ? (fields.some((f) => f.differs) ? 'update' : 'unchanged') : 'create';
        const copies = [];
        let copyIndex = 0;
        for (const r of groupRows) {
            if (!hasCopyData(r.cells))
                continue;
            copyIndex += 1;
            const cIssues = [];
            const cIncoming = {};
            for (const f of copyFields)
                cIncoming[f] = text(r.cells[f]);
            const rawCopyId = text(r.cells.copy_id);
            const code = text(r.cells.copy_code);
            let dbCopy;
            let cAction = 'create';
            if (rawCopyId) {
                if (!(0, exports.isUuid)(rawCopyId)) {
                    cIssues.push({ level: 'error', message: 'copy_id is not a valid copy id (leave it blank to add a new copy)' });
                    cAction = 'error';
                }
                else {
                    dbCopy = copiesById.get(rawCopyId.toLowerCase());
                    if (!dbCopy) {
                        cIssues.push({ level: 'error', message: 'no copy with this copy_id exists (leave copy_id blank to add it as a new copy)' });
                        cAction = 'error';
                    }
                    else if (!dbBook || dbCopy.bookId !== dbBook.id) {
                        cIssues.push({ level: 'error', message: `this copy belongs to ${bookTitleById.has(dbCopy.bookId) ? `"${bookTitleById.get(dbCopy.bookId)}"` : 'another book'}, not to the book on this row` });
                        cAction = 'error';
                    }
                    const dupRow = seenCopyIds.get(rawCopyId.toLowerCase());
                    if (dupRow) {
                        cIssues.push({ level: 'error', message: `copy_id also appears on row ${dupRow}` });
                        cAction = 'error';
                    }
                    seenCopyIds.set(rawCopyId.toLowerCase(), r.row);
                }
            }
            else if (code) {
                const byCode = copiesByCode.get(code);
                if (byCode) {
                    if (dbBook && byCode.bookId === dbBook.id) {
                        dbCopy = byCode;
                        cIssues.push({ level: 'warning', message: `copy_id is blank; matched the existing copy by its code "${code}"` });
                    }
                    else {
                        cIssues.push({ level: 'error', message: `code "${code}" is already used by ${bookTitleById.has(byCode.bookId) ? `"${bookTitleById.get(byCode.bookId)}"` : 'another book'}` });
                        cAction = 'error';
                    }
                }
            }
            else {
                cIssues.push({ level: 'info', message: 'no code given; the next free code is assigned when imported' });
            }
            if (code) {
                const dupRow = seenCodes.get(code);
                if (dupRow) {
                    cIssues.push({ level: 'error', message: `code "${code}" also appears on row ${dupRow}` });
                    cAction = 'error';
                }
                seenCodes.set(code, r.row);
                const owner = copiesByCode.get(code);
                if (dbCopy && owner && owner.id !== dbCopy.id) {
                    cIssues.push({ level: 'error', message: `code "${code}" is already used by another copy` });
                    cAction = 'error';
                }
            }
            const locked = [];
            const cCurrent = dbCopy ? (0, exports.copyToCells)(dbCopy) : null;
            const cParsed = toCopyValues(cIncoming, dbCopy?.status ?? 'available');
            if ('error' in cParsed) {
                cIssues.push({ level: 'error', message: cParsed.error });
                cAction = 'error';
            }
            else if (dbCopy) {
                // "borrowed" is set and cleared by lending/returning, never by a spreadsheet.
                if (cParsed.values.status !== dbCopy.status && (dbCopy.status === 'borrowed' || cParsed.values.status === 'borrowed')) {
                    locked.push('copy_status');
                    cIssues.push({ level: 'warning', message: `status ${dbCopy.status} → ${cParsed.values.status} is not applied: "borrowed" is only changed by lending and returning` });
                }
            }
            else if (cParsed.values.status === 'borrowed') {
                cIssues.push({ level: 'error', message: 'a new copy cannot start as "borrowed"; lend it from the circulation desk' });
                cAction = 'error';
            }
            if ('values' in cParsed)
                cIncoming.copy_status = cParsed.values.status;
            const cFields = diffFields(copyFields, cCurrent, cIncoming, locked);
            if (cAction !== 'error')
                cAction = dbCopy ? (cFields.some((f) => f.differs && !f.locked) ? 'update' : 'unchanged') : 'create';
            copies.push({ key: `${key}c${copyIndex}`, rows: [r.row], action: cAction, copyId: dbCopy?.id ?? null, code: code || dbCopy?.qrCode || null, fields: cFields, issues: cIssues, incoming: cIncoming });
        }
        if (dbBook) {
            const inFile = new Set(copies.map((c) => c.copyId).filter(Boolean));
            const missing = (copiesOfBook.get(dbBook.id) ?? []).filter((c) => !inFile.has(c.id));
            if (missing.length)
                issues.push({ level: 'info', message: `${missing.length} existing copy/copies of this book are not in the file and are left untouched (${missing.slice(0, 5).map((c) => c.qrCode).join(', ')}${missing.length > 5 ? ', …' : ''})` });
        }
        plans.push({ key, rows: groupRows.map((r) => r.row), action, bookId: dbBook?.id ?? null, title: text(first.cells.title) || null, fields, issues, incoming, current, copies });
    }
    return plans;
}
