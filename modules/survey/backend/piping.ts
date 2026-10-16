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

export const PIPE_TOKEN = /\{\{q:([0-9a-fA-F-]{36})\}\}/g;
export const EMPTY_PIPE = '…';
const OTHER_VALUE = '__other__';
const OTHER_PREFIX = '__other__:';

export interface PipeOption {
  value: string;
  label: string;
}

export interface PipeQuestion {
  id: string;
  type: string;
  title?: string | null;
  description?: string | null;
  config?: Record<string, unknown> | null;
  options: PipeOption[];
}

export interface PipeSection {
  id: string;
  title?: string | null;
  description?: string | null;
  questions: PipeQuestion[];
}

export type OptionsFromMode = 'selected' | 'unselected';
export interface OptionsFrom {
  questionId: string;
  mode: OptionsFromMode;
}

const CHOICE_TYPES = ['single_choice', 'multi_choice', 'dropdown'];

export function getOptionsFrom(question: Pick<PipeQuestion, 'config'>): OptionsFrom | null {
  const raw = question.config?.optionsFrom;
  if (!raw || typeof raw !== 'object') return null;
  const { questionId, mode } = raw as Record<string, unknown>;
  if (typeof questionId !== 'string' || (mode !== 'selected' && mode !== 'unselected')) return null;
  return { questionId, mode };
}

/** Question ids referenced by `{{q:…}}` tokens in a text. */
export function tokenIds(text: string | null | undefined): string[] {
  const ids: string[] = [];
  for (const match of (text ?? '').matchAll(PIPE_TOKEN)) ids.push(match[1].toLowerCase());
  return ids;
}

/** `text` with every token's question id replaced through `map` (used when a survey is copied: ids change). */
export function remapTokens(text: string | null | undefined, map: Map<string, string>): string | null | undefined {
  if (!text) return text;
  return text.replace(PIPE_TOKEN, (all, id: string) => {
    const next = map.get(id) ?? map.get(id.toLowerCase());
    return next ? `{{q:${next}}}` : all;
  });
}

/** Escapes the survey text markup (rich-text.ts), so a reader's answer can never format or link anything. */
export function escapeMarkup(value: string): string {
  return value.replace(/[\\*[\]{}$]/g, (c) => `\\${c}`);
}

function toArray(answer: unknown): string[] {
  if (Array.isArray(answer)) return answer.filter((v): v is string => typeof v === 'string');
  return typeof answer === 'string' && answer !== '' ? [answer] : [];
}

/** Human text for one stored answer of a question: option labels for choices, "Other" text, plain values otherwise. */
export function answerText(question: PipeQuestion, answer: unknown): string {
  if (answer === undefined || answer === null || answer === '') return '';
  if (CHOICE_TYPES.includes(question.type)) {
    return toArray(answer)
      .map((value) => (value.startsWith(OTHER_PREFIX) ? value.slice(OTHER_PREFIX.length) : (question.options.find((o) => o.value === value)?.label ?? value)))
      .join(', ');
  }
  return Array.isArray(answer) ? answer.join(', ') : String(answer);
}

/** `text` with every `{{q:id}}` replaced by the (markup-escaped) earlier answer, or "…" when there is none. */
export function pipeText(text: string | null | undefined, questionsById: Map<string, PipeQuestion>, answerOf: (questionId: string) => unknown): string {
  if (!text) return text ?? '';
  return text.replace(PIPE_TOKEN, (_all, id: string) => {
    const question = questionsById.get(id.toLowerCase()) ?? questionsById.get(id);
    const shown = question ? answerText(question, answerOf(question.id)) : '';
    return shown ? escapeMarkup(shown) : EMPTY_PIPE;
  });
}

/**
 * The options a carry-forward question really offers: the source question's options that were (or were
 * not) chosen. `null` when the question has no carry-forward (use its own options). "Other" is never carried.
 */
export function resolveOptions(question: PipeQuestion, questionsById: Map<string, PipeQuestion>, answerOf: (questionId: string) => unknown): PipeOption[] | null {
  const from = getOptionsFrom(question);
  if (!from) return null;
  const source = questionsById.get(from.questionId);
  if (!source) return [];
  const chosen = new Set(toArray(answerOf(source.id)).filter((v) => v !== OTHER_VALUE && !v.startsWith(OTHER_PREFIX)));
  return source.options.filter((o) => (from.mode === 'selected' ? chosen.has(o.value) : !chosen.has(o.value)));
}

/**
 * Build-time check of a whole structure; returns an English message for the first problem, or null.
 * Every token and every carry-forward source must exist, sit in an earlier section and (for carry-forward)
 * be a choice question; a carry-forward question may not itself be a source of more carry-forward or of logic.
 */
export function validatePiping(sections: PipeSection[], logicSourceIds: ReadonlySet<string> = new Set()): string | null {
  const sectionIndexOf = new Map<string, number>();
  const questionsById = new Map<string, PipeQuestion>();
  sections.forEach((section, index) => {
    for (const question of section.questions) {
      sectionIndexOf.set(question.id.toLowerCase(), index);
      questionsById.set(question.id.toLowerCase(), question);
    }
  });

  const checkTokens = (text: string | null | undefined, atSection: number, where: string): string | null => {
    for (const id of tokenIds(text)) {
      const at = sectionIndexOf.get(id);
      if (at === undefined) return `${where}: it inserts an answer from a question that no longer exists`;
      if (at >= atSection) return `${where}: it can only insert answers from questions in an earlier section`;
    }
    return null;
  };

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const problem = checkTokens(section.title, index, `Section "${section.title ?? ''}"`) ?? checkTokens(section.description, index, `Section "${section.title ?? ''}"`);
    if (problem) return problem;
    for (const question of section.questions) {
      const where = `Question "${question.title ?? ''}"`;
      const qProblem = checkTokens(question.title, index, where) ?? checkTokens(question.description, index, where);
      if (qProblem) return qProblem;
      const from = getOptionsFrom(question);
      if (question.config?.optionsFrom !== undefined && question.config?.optionsFrom !== null && !from) {
        return `${where}: the "take the choices from" setting is not valid`;
      }
      if (from) {
        if (!CHOICE_TYPES.includes(question.type)) return `${where}: only choice questions can take their choices from another question`;
        const source = questionsById.get(from.questionId.toLowerCase());
        const at = sectionIndexOf.get(from.questionId.toLowerCase());
        if (!source || at === undefined) return `${where}: the question its choices come from no longer exists`;
        if (at >= index) return `${where}: its choices can only come from a question in an earlier section`;
        if (!CHOICE_TYPES.includes(source.type)) return `${where}: its choices must come from a choice question`;
        if (getOptionsFrom(source)) return `${where}: its choices cannot come from a question that itself takes its choices from another`;
        if (logicSourceIds.has(question.id)) return `${where}: a question that takes its choices from another cannot be the condition of a show/hide rule`;
      }
    }
  }
  return null;
}
