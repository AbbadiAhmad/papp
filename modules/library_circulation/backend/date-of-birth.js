"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDateOfBirth = normalizeDateOfBirth;
exports.toDateOnly = toDateOnly;
exports.formatDateOnly = formatDateOnly;
/**
 * Date-of-birth helpers (calendar date, `YYYY-MM-DD`). A local copy of core's
 * `apps/api/src/core/users/date-of-birth.util.ts`: modules never import
 * core's `src/` (see platform.ts's docblock), and this is too small to be
 * worth a dist import.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST = '1900-01-01';
/** `YYYY-MM-DD` when it is a real calendar date between 1900 and today, else null. */
function normalizeDateOfBirth(input, today = new Date()) {
    const text = input.trim();
    if (!ISO_DATE.test(text))
        return null;
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text)
        return null;
    if (text < EARLIEST || text > today.toISOString().slice(0, 10))
        return null;
    return text;
}
function toDateOnly(normalized) {
    return new Date(`${normalized}T00:00:00.000Z`);
}
function formatDateOnly(date) {
    return date ? date.toISOString().slice(0, 10) : null;
}
