"use strict";
/**
 * Report filters (survey ext. I): a date range on when the response was submitted and "answer to question X is Y"
 * conditions. Import-free so the page builds the exact query the server parses (SURVEY-D8).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILTERABLE_TYPES = exports.EMPTY_FILTER = exports.MAX_ANSWER_FILTERS = void 0;
exports.parseReportFilter = parseReportFilter;
exports.toQuery = toQuery;
exports.dailyCounts = dailyCounts;
exports.dailyAverages = dailyAverages;
exports.MAX_ANSWER_FILTERS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
exports.EMPTY_FILTER = { answers: [] };
function parseDay(value) {
    if (!DAY.test(value))
        return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}
/** Turns the query string into a filter, or an English message for the first thing wrong with it. */
function parseReportFilter(query) {
    const filter = { answers: [] };
    if (query.from) {
        const from = parseDay(query.from);
        if (!from)
            return { error: 'The "from" date must look like 2026-01-31' };
        filter.from = from;
    }
    if (query.to) {
        const to = parseDay(query.to);
        if (!to)
            return { error: 'The "to" date must look like 2026-01-31' };
        filter.toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    }
    if (filter.from && filter.toExclusive && filter.toExclusive.getTime() <= filter.from.getTime())
        return { error: 'The "to" date must not be before the "from" date' };
    const raw = query.a === undefined ? [] : Array.isArray(query.a) ? query.a : [query.a];
    if (raw.length > exports.MAX_ANSWER_FILTERS)
        return { error: `At most ${exports.MAX_ANSWER_FILTERS} answer filters can be combined` };
    for (const item of raw) {
        const cut = item.indexOf(':');
        const questionId = cut > 0 ? item.slice(0, cut) : '';
        const value = cut > 0 ? item.slice(cut + 1) : '';
        if (!UUID.test(questionId) || value === '' || value.length > 200)
            return { error: 'An answer filter must look like <question id>:<answer>' };
        filter.answers.push({ questionId: questionId.toLowerCase(), value });
    }
    return { filter };
}
/** The query-string form of a filter (what the page sends). */
function toQuery(filter) {
    return {
        ...(filter.from ? { from: filter.from } : {}),
        ...(filter.to ? { to: filter.to } : {}),
        ...(filter.answers.length ? { a: filter.answers.map((c) => `${c.questionId}:${c.value}`) } : {}),
    };
}
exports.FILTERABLE_TYPES = ['single_choice', 'multi_choice', 'dropdown', 'linear_scale', 'rating'];
/** Responses per UTC day; days without any response are filled in when the span is at most a year, so a line chart stays honest. */
function dailyCounts(dates) {
    if (dates.length === 0)
        return [];
    const counts = new Map();
    for (const d of dates) {
        const key = d.toISOString().slice(0, 10);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const keys = [...counts.keys()].sort();
    const first = Date.parse(`${keys[0]}T00:00:00Z`);
    const last = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`);
    const spanDays = Math.round((last - first) / 86_400_000);
    if (spanDays > 366)
        return keys.map((date) => ({ date, count: counts.get(date) }));
    const out = [];
    for (let i = 0; i <= spanDays; i += 1) {
        const date = new Date(first + i * 86_400_000).toISOString().slice(0, 10);
        out.push({ date, count: counts.get(date) ?? 0 });
    }
    return out;
}
/** Average of numeric answers per UTC day (days with no answer are skipped; the line connects the days that have data). */
function dailyAverages(points) {
    const groups = new Map();
    for (const p of points) {
        const key = p.at.toISOString().slice(0, 10);
        groups.set(key, [...(groups.get(key) ?? []), p.value]);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({ date, average: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100, count: values.length }));
}
