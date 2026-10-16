/**
 * Survey-level options and availability (modules/survey/ROADMAP.md, phase C).
 * Framework-free like `logic-engine.ts` and `question-rules.ts`: the server
 * validates and enforces with it, the builder and the respondent page import
 * the `.ts` source (explicit extension, SURVEY-D8), so the rules cannot drift.
 */

import { ImageRef, parseImageRef } from './question-rules';

export const MAX_THANK_YOU_LENGTH = 4000;
export const MAX_RESPONSE_LIMIT = 1_000_000;

/** The shape stored in `survey_surveys.settings` (JSONB). Unknown keys are dropped on write. */
export interface SurveySettings {
  /** Shown after a successful submit instead of the default text. Plain text, line breaks kept. */
  thankYouMessage?: string;
  /** Show "page 2 of 4" progress on surveys with more than one section. */
  showProgressBar?: boolean;
  /** Picture shown at the top of the survey (phase D). */
  headerImage?: ImageRef;
  /** Only listed users and invited people may respond (SURVEY-D22). */
  restricted?: boolean;
  /** Email each respondent a copy of their answers (SURVEY-D22). */
  emailCopy?: boolean;
}

/** Returns a clean settings object (known keys only, trimmed, empty values removed). Never throws. */
export function normalizeSettings(input: unknown): SurveySettings {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const result: SurveySettings = {};
  if (typeof raw.thankYouMessage === 'string' && raw.thankYouMessage.trim()) {
    result.thankYouMessage = raw.thankYouMessage.trim().slice(0, MAX_THANK_YOU_LENGTH);
  }
  if (raw.showProgressBar === true) result.showProgressBar = true;
  if (raw.restricted === true) result.restricted = true;
  if (raw.emailCopy === true) result.emailCopy = true;
  const image = parseImageRef(raw.headerImage);
  if ('ref' in image && image.ref) result.headerImage = image.ref;
  return result;
}

/** English text of the first problem with an incoming settings/schedule change, or null. */
export function validateSurveyOptions(input: {
  thankYouMessage?: unknown;
  responseLimit?: unknown;
  opensAt?: Date | string | null;
  closesAt?: Date | string | null;
}): string | null {
  if (typeof input.thankYouMessage === 'string' && input.thankYouMessage.length > MAX_THANK_YOU_LENGTH) {
    return `The thank-you message is too long (at most ${MAX_THANK_YOU_LENGTH} characters)`;
  }
  if (input.responseLimit !== undefined && input.responseLimit !== null) {
    const n = input.responseLimit;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_RESPONSE_LIMIT) {
      return `The response limit must be a whole number from 1 to ${MAX_RESPONSE_LIMIT}`;
    }
  }
  const opens = input.opensAt ? new Date(input.opensAt) : null;
  const closes = input.closesAt ? new Date(input.closesAt) : null;
  if ((opens && Number.isNaN(opens.getTime())) || (closes && Number.isNaN(closes.getTime()))) return 'The opening or closing date is not valid';
  if (opens && closes && closes.getTime() <= opens.getTime()) return 'The closing date must be after the opening date';
  return null;
}

/**
 * Why a PUBLISHED survey is or is not taking responses right now:
 *  - `not_open_yet`: `opensAt` is in the future
 *  - `ended`: `closesAt` has passed
 *  - `full`: `responseLimit` reached (new responses only; people editing their own answer are unaffected)
 *  - `open`: taking responses
 * Draft, closed and archived surveys have their own status and return null here.
 */
export type SurveyAvailability = 'open' | 'not_open_yet' | 'ended' | 'full';

export function computeAvailability(
  survey: { status: string; opensAt?: Date | string | null; closesAt?: Date | string | null; responseLimit?: number | null },
  responseCount: number,
  now: Date = new Date(),
): SurveyAvailability | null {
  if (survey.status !== 'published') return null;
  const opens = survey.opensAt ? new Date(survey.opensAt) : null;
  const closes = survey.closesAt ? new Date(survey.closesAt) : null;
  if (opens && opens.getTime() > now.getTime()) return 'not_open_yet';
  if (closes && closes.getTime() <= now.getTime()) return 'ended';
  if (survey.responseLimit && responseCount >= survey.responseLimit) return 'full';
  return 'open';
}
