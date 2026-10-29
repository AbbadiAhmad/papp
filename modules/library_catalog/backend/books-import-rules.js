"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUuid = exports.TEXT_FIELDS = void 0;
exports.toBookValues = toBookValues;
exports.changedFields = changedFields;
/**
 * Pure rules for the books Excel import (LIBRARY_CATALOG-D31): the workbook is the one the export produces, so a
 * librarian can export, edit cells and import it back. Framework-free so the service and the unit tests share it.
 *
 * A row with an `id` that exists updates that book (only the columns that differ); a row with no `id` creates a
 * new book with one auto-coded copy. Cells of optional columns that are blank clear the field. `total_copies`
 * and any unknown column are ignored (copies are managed on the book's page).
 */
exports.TEXT_FIELDS = ['title', 'author', 'publisher', 'category', 'reading_level', 'language'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID.test(value);
exports.isUuid = isUuid;
/** Turns one raw row into book values, or says why it is invalid. */
function toBookValues(cells) {
    const title = (cells.title ?? '').trim();
    if (!title)
        return { error: 'title is required' };
    const optional = (key) => {
        const value = (cells[key] ?? '').trim();
        return value ? value : null;
    };
    let pageCount = null;
    const rawPages = (cells.page_count ?? '').trim();
    if (rawPages) {
        const parsed = Number(rawPages);
        if (!Number.isInteger(parsed) || parsed < 1)
            return { error: 'page_count must be a whole number of at least 1' };
        pageCount = parsed;
    }
    return {
        values: {
            title,
            author: optional('author'),
            publisher: optional('publisher'),
            category: optional('category'),
            readingLevel: optional('reading_level'),
            language: optional('language'),
            pageCount,
        },
    };
}
/** The names of the fields whose value differs between the stored book and the imported row. */
function changedFields(current, next) {
    return Object.keys(next).filter((key) => (current[key] ?? null) !== (next[key] ?? null));
}
