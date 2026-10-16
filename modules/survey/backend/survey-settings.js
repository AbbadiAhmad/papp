"use strict";
/**
 * Survey-level options and availability (modules/survey/ROADMAP.md, phase C).
 * Framework-free like `logic-engine.ts` and `question-rules.ts`: the server
 * validates and enforces with it, the builder and the respondent page import
 * the `.ts` source (explicit extension, SURVEY-D8), so the rules cannot drift.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RESPONSE_LIMIT = exports.MAX_THANK_YOU_LENGTH = void 0;
exports.normalizeSettings = normalizeSettings;
exports.validateSurveyOptions = validateSurveyOptions;
exports.computeAvailability = computeAvailability;
const question_rules_1 = require("./question-rules");
exports.MAX_THANK_YOU_LENGTH = 4000;
exports.MAX_RESPONSE_LIMIT = 1_000_000;
/** Returns a clean settings object (known keys only, trimmed, empty values removed). Never throws. */
function normalizeSettings(input) {
    const raw = typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
    const result = {};
    if (typeof raw.thankYouMessage === 'string' && raw.thankYouMessage.trim()) {
        result.thankYouMessage = raw.thankYouMessage.trim().slice(0, exports.MAX_THANK_YOU_LENGTH);
    }
    if (raw.showProgressBar === true)
        result.showProgressBar = true;
    if (raw.restricted === true)
        result.restricted = true;
    if (raw.emailCopy === true)
        result.emailCopy = true;
    const image = (0, question_rules_1.parseImageRef)(raw.headerImage);
    if ('ref' in image && image.ref)
        result.headerImage = image.ref;
    return result;
}
/** English text of the first problem with an incoming settings/schedule change, or null. */
function validateSurveyOptions(input) {
    if (typeof input.thankYouMessage === 'string' && input.thankYouMessage.length > exports.MAX_THANK_YOU_LENGTH) {
        return `The thank-you message is too long (at most ${exports.MAX_THANK_YOU_LENGTH} characters)`;
    }
    if (input.responseLimit !== undefined && input.responseLimit !== null) {
        const n = input.responseLimit;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > exports.MAX_RESPONSE_LIMIT) {
            return `The response limit must be a whole number from 1 to ${exports.MAX_RESPONSE_LIMIT}`;
        }
    }
    const opens = input.opensAt ? new Date(input.opensAt) : null;
    const closes = input.closesAt ? new Date(input.closesAt) : null;
    if ((opens && Number.isNaN(opens.getTime())) || (closes && Number.isNaN(closes.getTime())))
        return 'The opening or closing date is not valid';
    if (opens && closes && closes.getTime() <= opens.getTime())
        return 'The closing date must be after the opening date';
    return null;
}
function computeAvailability(survey, responseCount, now = new Date()) {
    if (survey.status !== 'published')
        return null;
    const opens = survey.opensAt ? new Date(survey.opensAt) : null;
    const closes = survey.closesAt ? new Date(survey.closesAt) : null;
    if (opens && opens.getTime() > now.getTime())
        return 'not_open_yet';
    if (closes && closes.getTime() <= now.getTime())
        return 'ended';
    if (survey.responseLimit && responseCount >= survey.responseLimit)
        return 'full';
    return 'open';
}
