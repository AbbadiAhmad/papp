/**
 * Per-question configuration and answer rules (docs: modules/survey/ROADMAP.md
 * section 3, phase A). Deliberately plain TypeScript with ZERO framework
 * dependency, exactly like `logic-engine.ts`, so ONE copy of the rules is
 * used by:
 *  - the builder save (`SurveysService.validateStructure` -> `validateQuestionConfig`),
 *  - the submit path (`ResponsesService` -> `validateAnswer`), which never
 *    trusts the browser's own checks,
 *  - the respondent page, which runs the same `validateAnswer` live so the
 *    message shown next to a field is exactly what the server would say
 *    (imported with an explicit `.ts` extension, see SURVEY-D8).
 *
 * Problems are returned as `{code, params}` (never thrown, never translated
 * here): the server renders `describeProblem` (English), the browser maps
 * `code` to a translated string (`survey.rules.<code>`). An owner's custom
 * message (`config.validation.message`) rides along as `problem.message`.
 *
 * Stored shapes (all inside the question's existing `config` JSONB, so no
 * migration):
 *  - short_text / paragraph: `validation: {kind, maxLength?, min?, max?, integer?, message?}`, `placeholder?`
 *  - multi_choice: `minSelections?`, `maxSelections?`, `exclusiveOptionValue?`
 *  - single_choice / dropdown / multi_choice: `allowOther?`, `otherLabel?`
 *  - linear_scale: `min?`, `max?`; rating: `max?`
 * An "Other" answer is stored as the string `__other__:<text>` (inside the
 * array for multi_choice), so every existing consumer that treats choice
 * answers as strings keeps working.
 */

// --- pictures (phase D) --------------------------------------------------------
// Lives here (not in media-rules.ts) because the builder imports this file with an explicit `.ts`
// extension (SURVEY-D8); a second shared file importing a sibling would hit the dual-ship hazard.

export const MAX_ALT_LENGTH = 200;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface ImageRef {
  mediaId: string;
  /** Text read out to screen-reader users; required so every picture is accessible. */
  alt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** `null` = no image; throws-free: returns the cleaned ref, or an error string. */
export function parseImageRef(input: unknown): { ref: ImageRef | null } | { error: string } {
  if (input === undefined || input === null) return { ref: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'The image is not valid' };
  const raw = input as Record<string, unknown>;
  if (!isUuid(raw.mediaId)) return { error: 'The image is not valid' };
  const alt = typeof raw.alt === 'string' ? raw.alt.trim() : '';
  if (!alt) return { error: 'Describe the image (alternative text) so everyone can understand it' };
  if (alt.length > MAX_ALT_LENGTH) return { error: `The image description is too long (at most ${MAX_ALT_LENGTH} characters)` };
  return { ref: { mediaId: raw.mediaId.toLowerCase(), alt } };
}

export type QuestionTypeName =
  | 'short_text'
  | 'paragraph'
  | 'single_choice'
  | 'multi_choice'
  | 'dropdown'
  | 'linear_scale'
  | 'date'
  | 'time'
  | 'rating';

export const OTHER_OPTION_VALUE = '__other__';
export const OTHER_PREFIX = '__other__:';
/** Hard ceiling for any text answer, even without a configured limit (protects the database). */
export const MAX_TEXT_LENGTH = 10000;
export const MAX_OTHER_LENGTH = 500;
export const MAX_MESSAGE_LENGTH = 250;
export const MAX_PLACEHOLDER_LENGTH = 200;
export const MAX_LABEL_LENGTH = 100;

export type ValidationKind = 'text' | 'number' | 'email' | 'url';
export const VALIDATION_KINDS: readonly ValidationKind[] = ['text', 'number', 'email', 'url'];

export interface RuleProblem {
  code: string;
  params?: Record<string, string | number>;
  /** The owner's custom message, when one applies to this problem. */
  message?: string;
}

const CHOICE_TYPES: readonly QuestionTypeName[] = ['single_choice', 'multi_choice', 'dropdown'];
const TEXT_TYPES: readonly QuestionTypeName[] = ['short_text', 'paragraph'];

const ENGLISH: Record<string, string> = {
  // answers
  not_text: 'expects text',
  not_number_value: 'expects a number',
  too_long: 'is too long (at most {max} characters)',
  not_number: 'must be a number (digits 0-9)',
  not_integer: 'must be a whole number',
  below_min: 'must be at least {min}',
  above_max: 'must be at most {max}',
  bad_email: 'must be a valid email address',
  bad_image: '{detail}',
  bad_video_url: 'the video link must be a web address starting with http:// or https://',
  bad_url: 'must be a valid web address starting with http:// or https://',
  bad_date: 'must be a valid date',
  bad_time: 'must be a valid time',
  not_scale_value: 'must be a whole number from {min} to {max}',
  invalid_option: 'is not one of the available options',
  invalid_options: 'contains an option that is not available',
  other_not_allowed: 'does not accept an "Other" answer',
  other_empty: 'needs a text for the "Other" answer',
  other_too_long: 'has an "Other" text that is too long (at most {max} characters)',
  duplicate_selection: 'has the same option selected twice',
  too_few_selected: 'needs at least {min} selections',
  too_many_selected: 'allows at most {max} selections',
  exclusive_conflict: 'cannot combine this option with others',
  // builder configuration
  config_not_object: 'settings must be an object',
  bad_config_number: 'setting "{key}" must be a whole number of 0 or more',
  min_gt_max: 'the minimum cannot be greater than the maximum',
  limit_exceeds_options: 'the selection limit is larger than the number of options ({count})',
  unknown_exclusive: 'the exclusive option does not exist on this question',
  config_not_allowed: 'setting "{key}" is not available for this question type',
  bad_validation_kind: 'unknown validation type "{kind}"',
  text_too_long_config: 'text "{key}" is too long (at most {max} characters)',
  bad_scale_config: 'a scale needs whole numbers with the minimum below the maximum',
  reserved_option_value: 'the option value "{value}" is reserved',
  duplicate_option_value: 'two options have the same value "{value}"',
};

/** English text for a problem (server error messages, logs). */
export function describeProblem(problem: RuleProblem): string {
  if (problem.message) return problem.message;
  const template = ENGLISH[problem.code] ?? problem.code;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(problem.params?.[key] ?? ''));
}

// --- "Other" encoding helpers ------------------------------------------------

export function encodeOther(text: string): string {
  return `${OTHER_PREFIX}${text}`;
}

export function isOtherAnswer(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(OTHER_PREFIX);
}

export function otherText(value: string): string {
  return value.slice(OTHER_PREFIX.length);
}

/** Human-readable form of any stored answer (reports, exports, notifications): arrays joined, "Other" shown with its text. */
export function formatAnswerForDisplay(value: unknown, otherLabel = 'Other'): string {
  const one = (v: unknown): string => (isOtherAnswer(v) ? `${otherLabel}: ${otherText(v)}` : String(v ?? ''));
  return Array.isArray(value) ? value.map(one).join(', ') : one(value);
}

// --- configuration -------------------------------------------------------------

type Config = Record<string, unknown>;

function isPlainObject(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Scale range of a linear_scale (min..max, default 1..5) or rating (always 1..max, default 5). A 0 start is valid. */
export function scaleBounds(type: QuestionTypeName, config: Config | null | undefined): { min: number; max: number } {
  const c = config ?? {};
  const min = type === 'linear_scale' && typeof c.min === 'number' && Number.isFinite(c.min) ? c.min : 1;
  const max = typeof c.max === 'number' && Number.isFinite(c.max) ? c.max : 5;
  return { min, max };
}

/**
 * Checks a question's `config` against its type. Returns the first problem or
 * null. `optionValues` are the question's own option values (builder payload).
 * Unknown keys are left alone (forward compatible); known keys are strict.
 */
export function validateQuestionConfig(type: QuestionTypeName, config: unknown, optionValues: readonly string[] = []): RuleProblem | null {
  if (config === undefined || config === null) return null;
  if (!isPlainObject(config)) return { code: 'config_not_object' };

  const isChoice = CHOICE_TYPES.includes(type);

  // Keys that only make sense for some types.
  for (const key of ['minSelections', 'maxSelections', 'exclusiveOptionValue']) {
    if (config[key] !== undefined && type !== 'multi_choice') return { code: 'config_not_allowed', params: { key } };
  }
  for (const key of ['allowOther', 'otherLabel']) {
    if (config[key] !== undefined && !isChoice) return { code: 'config_not_allowed', params: { key } };
  }
  if (config.validation !== undefined && !TEXT_TYPES.includes(type)) return { code: 'config_not_allowed', params: { key: 'validation' } };
  if (config.placeholder !== undefined && !TEXT_TYPES.includes(type)) return { code: 'config_not_allowed', params: { key: 'placeholder' } };

  if (config.image !== undefined && config.image !== null) {
    const parsed = parseImageRef(config.image);
    if ('error' in parsed) return { code: 'bad_image', params: { detail: parsed.error } };
  }
  if (config.videoUrl !== undefined && config.videoUrl !== null && config.videoUrl !== '') {
    // Shown as a plain link, never embedded (survey ext. E): so only the address shape matters.
    let ok = typeof config.videoUrl === 'string' && config.videoUrl.length <= 2048;
    if (ok) {
      try {
        const protocol = new URL(config.videoUrl as string).protocol;
        ok = protocol === 'https:' || protocol === 'http:';
      } catch {
        ok = false;
      }
    }
    if (!ok) return { code: 'bad_video_url' };
  }
  if (typeof config.placeholder === 'string' && config.placeholder.length > MAX_PLACEHOLDER_LENGTH) {
    return { code: 'text_too_long_config', params: { key: 'placeholder', max: MAX_PLACEHOLDER_LENGTH } };
  }
  if (typeof config.otherLabel === 'string' && config.otherLabel.length > MAX_LABEL_LENGTH) {
    return { code: 'text_too_long_config', params: { key: 'otherLabel', max: MAX_LABEL_LENGTH } };
  }

  if (type === 'multi_choice') {
    for (const key of ['minSelections', 'maxSelections'] as const) {
      if (config[key] !== undefined && !isCount(config[key])) return { code: 'bad_config_number', params: { key } };
    }
    const min = numberOrUndefined(config.minSelections);
    const max = numberOrUndefined(config.maxSelections);
    if (min !== undefined && max !== undefined && min > max) return { code: 'min_gt_max' };
    const available = optionValues.length + (config.allowOther === true ? 1 : 0);
    if ((min !== undefined && min > available) || (max !== undefined && max > available && max > 0 && available > 0)) {
      return { code: 'limit_exceeds_options', params: { count: available } };
    }
    if (config.exclusiveOptionValue !== undefined && config.exclusiveOptionValue !== null && config.exclusiveOptionValue !== '') {
      if (typeof config.exclusiveOptionValue !== 'string' || !optionValues.includes(config.exclusiveOptionValue)) return { code: 'unknown_exclusive' };
    }
  }

  if (type === 'linear_scale' || type === 'rating') {
    const bounds = scaleBounds(type, config);
    const rawMin = config.min;
    const rawMax = config.max;
    const intOrUndef = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isInteger(v));
    if (!intOrUndef(rawMin) || !intOrUndef(rawMax) || bounds.min >= bounds.max) return { code: 'bad_scale_config' };
  }

  if (config.validation !== undefined) {
    const v = config.validation;
    if (!isPlainObject(v)) return { code: 'config_not_object' };
    if (typeof v.kind !== 'string' || !VALIDATION_KINDS.includes(v.kind as ValidationKind)) {
      return { code: 'bad_validation_kind', params: { kind: String(v.kind) } };
    }
    if (type === 'paragraph' && v.kind !== 'text') return { code: 'bad_validation_kind', params: { kind: v.kind } };
    if (v.maxLength !== undefined && (!isCount(v.maxLength) || v.maxLength < 1 || v.maxLength > MAX_TEXT_LENGTH)) {
      return { code: 'bad_config_number', params: { key: 'maxLength' } };
    }
    for (const key of ['min', 'max'] as const) {
      if (v[key] !== undefined && (typeof v[key] !== 'number' || !Number.isFinite(v[key] as number))) return { code: 'bad_config_number', params: { key } };
    }
    if (typeof v.min === 'number' && typeof v.max === 'number' && v.min > v.max) return { code: 'min_gt_max' };
    if (typeof v.message === 'string' && v.message.length > MAX_MESSAGE_LENGTH) {
      return { code: 'text_too_long_config', params: { key: 'message', max: MAX_MESSAGE_LENGTH } };
    }
  }

  return null;
}

/** Option-level checks for a choice question's builder payload (reserved/duplicate values). */
export function validateOptionValues(optionValues: readonly string[]): RuleProblem | null {
  const seen = new Set<string>();
  for (const value of optionValues) {
    if (value === OTHER_OPTION_VALUE || value.startsWith(OTHER_PREFIX)) return { code: 'reserved_option_value', params: { value } };
    if (seen.has(value)) return { code: 'duplicate_option_value', params: { value } };
    seen.add(value);
  }
  return null;
}

// --- answers --------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function validText(config: Config, value: string, type: QuestionTypeName): RuleProblem | null {
  const rule = isPlainObject(config.validation) ? config.validation : null;
  const custom = rule && typeof rule.message === 'string' && rule.message.trim() ? rule.message.trim() : undefined;
  const fail = (code: string, params?: Record<string, string | number>): RuleProblem => ({ code, params, message: custom });

  const maxLength = rule && isCount(rule.maxLength) && rule.maxLength > 0 ? Math.min(rule.maxLength, MAX_TEXT_LENGTH) : MAX_TEXT_LENGTH;
  if (value.length > maxLength) return fail('too_long', { max: maxLength });
  if (!rule || type === 'paragraph') return null;

  const kind = rule.kind;
  const trimmed = value.trim();
  if (kind === 'number') {
    if (!(rule.integer === true ? INTEGER : NUMBER).test(trimmed)) return fail(rule.integer === true && NUMBER.test(trimmed) ? 'not_integer' : 'not_number');
    const n = Number(trimmed);
    if (typeof rule.min === 'number' && n < rule.min) return fail('below_min', { min: rule.min });
    if (typeof rule.max === 'number' && n > rule.max) return fail('above_max', { max: rule.max });
  } else if (kind === 'email') {
    if (trimmed.length > 254 || !EMAIL.test(trimmed)) return fail('bad_email');
  } else if (kind === 'url') {
    try {
      const url = new URL(trimmed);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || trimmed.length > 2048) return fail('bad_url');
    } catch {
      return fail('bad_url');
    }
  }
  return null;
}

function checkOther(config: Config, text: string): RuleProblem | null {
  if (config.allowOther !== true) return { code: 'other_not_allowed' };
  if (!text.trim()) return { code: 'other_empty' };
  if (text.length > MAX_OTHER_LENGTH) return { code: 'other_too_long', params: { max: MAX_OTHER_LENGTH } };
  return null;
}

/**
 * Checks ONE non-empty answer against its question. Returns the first problem
 * or null. Emptiness / `required` is handled by the caller (an optional
 * question may simply be left blank, but a partly-filled one must be valid).
 */
export function validateAnswer(
  type: QuestionTypeName,
  config: unknown,
  optionValues: readonly string[],
  value: unknown,
): RuleProblem | null {
  const c: Config = isPlainObject(config) ? config : {};

  switch (type) {
    case 'single_choice':
    case 'dropdown': {
      if (typeof value !== 'string') return { code: 'invalid_option' };
      if (isOtherAnswer(value)) return checkOther(c, otherText(value));
      return optionValues.includes(value) ? null : { code: 'invalid_option' };
    }
    case 'multi_choice': {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return { code: 'invalid_options' };
      const selected = value as string[];
      if (new Set(selected).size !== selected.length) return { code: 'duplicate_selection' };
      let others = 0;
      for (const v of selected) {
        if (isOtherAnswer(v)) {
          others += 1;
          const problem = checkOther(c, otherText(v));
          if (problem) return problem;
        } else if (!optionValues.includes(v)) {
          return { code: 'invalid_options' };
        }
      }
      if (others > 1) return { code: 'duplicate_selection' };
      const exclusive = typeof c.exclusiveOptionValue === 'string' && c.exclusiveOptionValue ? c.exclusiveOptionValue : null;
      if (exclusive && selected.includes(exclusive)) {
        // The exclusive choice stands alone and is exempt from the count limits.
        return selected.length > 1 ? { code: 'exclusive_conflict' } : null;
      }
      if (isCount(c.minSelections) && c.minSelections > 0 && selected.length < c.minSelections) {
        return { code: 'too_few_selected', params: { min: c.minSelections } };
      }
      if (isCount(c.maxSelections) && c.maxSelections > 0 && selected.length > c.maxSelections) {
        return { code: 'too_many_selected', params: { max: c.maxSelections } };
      }
      return null;
    }
    case 'linear_scale':
    case 'rating': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { code: 'not_number_value' };
      const { min, max } = scaleBounds(type, c);
      return Number.isInteger(value) && value >= min && value <= max ? null : { code: 'not_scale_value', params: { min, max } };
    }
    case 'short_text':
    case 'paragraph':
      if (typeof value !== 'string') return { code: 'not_text' };
      return validText(c, value, type);
    case 'date': {
      if (typeof value !== 'string') return { code: 'not_text' };
      const m = DATE.exec(value);
      if (!m) return { code: 'bad_date' };
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const parsed = new Date(Date.UTC(y, mo - 1, d));
      return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === mo - 1 && parsed.getUTCDate() === d ? null : { code: 'bad_date' };
    }
    case 'time':
      if (typeof value !== 'string') return { code: 'not_text' };
      return TIME.test(value) ? null : { code: 'bad_time' };
  }
}

/** True for the "nothing answered" shapes (undefined, null, empty text, empty selection). */
export function isEmptyAnswer(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

// --- reporting helpers (pure, shared by ReportsService and the tests) ------------

export interface ChoiceSummary {
  optionCounts: Array<{ value: string; label: string; count: number }>;
  /** The free texts of "Other" answers (capped), newest data order preserved. */
  otherAnswers: string[];
}

/** Counts per option; "Other" answers are collapsed into one extra bar and their texts listed separately. */
export function summarizeChoiceAnswers(
  options: ReadonlyArray<{ value: string; label: string }>,
  values: readonly unknown[],
  config: unknown,
  textCap = 200,
): ChoiceSummary {
  const c: Config = isPlainObject(config) ? config : {};
  const counts = new Map<string, number>();
  const otherAnswers: string[] = [];
  let otherCount = 0;
  for (const value of values) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== 'string') continue;
      if (isOtherAnswer(v)) {
        otherCount += 1;
        if (otherAnswers.length < textCap) otherAnswers.push(otherText(v));
      } else {
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
  }
  const optionCounts = options.map((o) => ({ value: o.value, label: o.label, count: counts.get(o.value) ?? 0 }));
  if (c.allowOther === true || otherCount > 0) {
    const label = typeof c.otherLabel === 'string' && c.otherLabel.trim() ? c.otherLabel.trim() : 'Other';
    optionCounts.push({ value: OTHER_OPTION_VALUE, label, count: otherCount });
  }
  return { optionCounts, otherAnswers };
}

/** Same shape as the input, with "Other" answers turned into readable text (pivot dataset, exports). */
export function answerForDisplay(value: unknown, otherLabel = 'Other'): unknown {
  if (Array.isArray(value)) return value.map((v) => (isOtherAnswer(v) ? `${otherLabel}: ${otherText(v)}` : v));
  return isOtherAnswer(value) ? `${otherLabel}: ${otherText(value)}` : value;
}
