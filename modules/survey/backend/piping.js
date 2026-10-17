"use strict";
/**
 * Piping and carry-forward (survey ext. F). Framework-free and import-free (SURVEY-D8: the respondent
 * page imports this `.ts` file directly, so it must never import a sibling).
 *
 *  - Piping: a title/description may contain `{{q:<question id>}}`; while the reader fills the survey it is
 *    replaced by their earlier answer to that question (the chosen option's label for choice questions).
 *  - Carry-forward: a choice question may take its options from an earlier choice question
 *    (`config.optionsFrom = { questionId, mode: 'selected' | 'unselected' }`): the options the reader
 *    ticked, or the ones they did not.
 *
 * In both cases the source must sit in an EARLIER section, so its answer is final by the time it is used
 * (a reader can still go Back and change it; the page recomputes).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_PIPE = exports.PIPE_TOKEN = void 0;
exports.getOptionsFrom = getOptionsFrom;
exports.tokenIds = tokenIds;
exports.remapTokens = remapTokens;
exports.escapeMarkup = escapeMarkup;
exports.answerText = answerText;
exports.pipeText = pipeText;
exports.resolveOptions = resolveOptions;
exports.validatePiping = validatePiping;
exports.PIPE_TOKEN = /\{\{q:([0-9a-fA-F-]{36})\}\}/g;
exports.EMPTY_PIPE = '…';
const OTHER_VALUE = '__other__';
const OTHER_PREFIX = '__other__:';
const CHOICE_TYPES = ['single_choice', 'multi_choice', 'dropdown'];
function getOptionsFrom(question) {
    const raw = question.config?.optionsFrom;
    if (!raw || typeof raw !== 'object')
        return null;
    const { questionId, mode } = raw;
    if (typeof questionId !== 'string' || (mode !== 'selected' && mode !== 'unselected'))
        return null;
    return { questionId, mode };
}
/** Question ids referenced by `{{q:…}}` tokens in a text. */
function tokenIds(text) {
    const ids = [];
    for (const match of (text ?? '').matchAll(exports.PIPE_TOKEN))
        ids.push(match[1].toLowerCase());
    return ids;
}
/** `text` with every token's question id replaced through `map` (used when a survey is copied: ids change). */
function remapTokens(text, map) {
    if (!text)
        return text;
    return text.replace(exports.PIPE_TOKEN, (all, id) => {
        const next = map.get(id) ?? map.get(id.toLowerCase());
        return next ? `{{q:${next}}}` : all;
    });
}
/** Escapes the survey text markup (rich-text.ts), so a reader's answer can never format or link anything. */
function escapeMarkup(value) {
    return value.replace(/[\\*[\]{}$]/g, (c) => `\\${c}`);
}
function toArray(answer) {
    if (Array.isArray(answer))
        return answer.filter((v) => typeof v === 'string');
    return typeof answer === 'string' && answer !== '' ? [answer] : [];
}
/** Human text for one stored answer of a question: option labels for choices, "Other" text, plain values otherwise. */
function answerText(question, answer) {
    if (answer === undefined || answer === null || answer === '')
        return '';
    if (CHOICE_TYPES.includes(question.type)) {
        return toArray(answer)
            .map((value) => (value.startsWith(OTHER_PREFIX) ? value.slice(OTHER_PREFIX.length) : (question.options.find((o) => o.value === value)?.label ?? value)))
            .join(', ');
    }
    return Array.isArray(answer) ? answer.join(', ') : String(answer);
}
/** `text` with every `{{q:id}}` replaced by the (markup-escaped) earlier answer, or "…" when there is none. */
function pipeText(text, questionsById, answerOf) {
    if (!text)
        return text ?? '';
    return text.replace(exports.PIPE_TOKEN, (_all, id) => {
        const question = questionsById.get(id.toLowerCase()) ?? questionsById.get(id);
        const shown = question ? answerText(question, answerOf(question.id)) : '';
        return shown ? escapeMarkup(shown) : exports.EMPTY_PIPE;
    });
}
/**
 * The options a carry-forward question really offers: the source question's options that were (or were
 * not) chosen. `null` when the question has no carry-forward (use its own options). "Other" is never carried.
 */
function resolveOptions(question, questionsById, answerOf) {
    const from = getOptionsFrom(question);
    if (!from)
        return null;
    const source = questionsById.get(from.questionId);
    if (!source)
        return [];
    const chosen = new Set(toArray(answerOf(source.id)).filter((v) => v !== OTHER_VALUE && !v.startsWith(OTHER_PREFIX)));
    return source.options.filter((o) => (from.mode === 'selected' ? chosen.has(o.value) : !chosen.has(o.value)));
}
/**
 * Build-time check of a whole structure; returns an English message for the first problem, or null.
 * Every token and every carry-forward source must exist, sit in an earlier section and (for carry-forward)
 * be a choice question; a carry-forward question may not itself be a source of more carry-forward or of logic.
 */
function validatePiping(sections, logicSourceIds = new Set()) {
    const sectionIndexOf = new Map();
    const questionsById = new Map();
    sections.forEach((section, index) => {
        for (const question of section.questions) {
            sectionIndexOf.set(question.id.toLowerCase(), index);
            questionsById.set(question.id.toLowerCase(), question);
        }
    });
    const checkTokens = (text, atSection, where) => {
        for (const id of tokenIds(text)) {
            const at = sectionIndexOf.get(id);
            if (at === undefined)
                return `${where}: it inserts an answer from a question that no longer exists`;
            if (at >= atSection)
                return `${where}: it can only insert answers from questions in an earlier section`;
        }
        return null;
    };
    for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index];
        const problem = checkTokens(section.title, index, `Section "${section.title ?? ''}"`) ?? checkTokens(section.description, index, `Section "${section.title ?? ''}"`);
        if (problem)
            return problem;
        for (const question of section.questions) {
            const where = `Question "${question.title ?? ''}"`;
            const qProblem = checkTokens(question.title, index, where) ?? checkTokens(question.description, index, where);
            if (qProblem)
                return qProblem;
            const from = getOptionsFrom(question);
            if (question.config?.optionsFrom !== undefined && question.config?.optionsFrom !== null && !from) {
                return `${where}: the "take the choices from" setting is not valid`;
            }
            if (from) {
                if (!CHOICE_TYPES.includes(question.type))
                    return `${where}: only choice questions can take their choices from another question`;
                const source = questionsById.get(from.questionId.toLowerCase());
                const at = sectionIndexOf.get(from.questionId.toLowerCase());
                if (!source || at === undefined)
                    return `${where}: the question its choices come from no longer exists`;
                if (at >= index)
                    return `${where}: its choices can only come from a question in an earlier section`;
                if (!CHOICE_TYPES.includes(source.type))
                    return `${where}: its choices must come from a choice question`;
                if (getOptionsFrom(source))
                    return `${where}: its choices cannot come from a question that itself takes its choices from another`;
                if (logicSourceIds.has(question.id))
                    return `${where}: a question that takes its choices from another cannot be the condition of a show/hide rule`;
            }
        }
    }
    return null;
}
