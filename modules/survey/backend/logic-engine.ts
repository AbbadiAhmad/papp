/**
 * The conditional show/hide engine (docs/DECISIONS.md has the full design
 * rationale). Deliberately plain TypeScript with zero framework dependency
 * (no NestJS, no React) so it can be imported by BOTH sides of this module
 * without duplicating the logic: the backend imports it (via its own
 * compiled `.js` sibling, same as every other backend file in this module)
 * to independently re-validate a submitted answer set never includes a
 * currently-hidden required question, and the frontend imports the `.ts`
 * source directly (Vite handles this the same way it already does for every
 * other module `.tsx` file) to recompute which sections/questions are
 * visible live, as the respondent answers.
 *
 * Visibility semantics:
 *  - A section/question with ZERO rules targeting it is ALWAYS visible.
 *  - A target with ANY rule is HIDDEN BY DEFAULT. It becomes visible only if
 *    at least one currently-matching `show` rule targets it; a currently-
 *    matching `hide` rule ALWAYS wins over a `show` rule for the same
 *    target (a conflicting pair of rules fails safe toward hidden).
 *  - A rule "currently matches" when the respondent's answer to
 *    `sourceQuestionId` includes `sourceOptionValue` — for `single_choice`/
 *    `dropdown` that means the answer equals that value; for `multi_choice`
 *    it means the answer array includes that value. An unanswered source
 *    question matches no rule.
 *  - Hiding a SECTION hides every question inside it, regardless of any
 *    question-level rule that might otherwise show one of them (a hidden
 *    section is fully hidden, not partially).
 *
 * Section navigation (sections are shown one page at a time):
 *  - After a section the respondent goes to the NEXT visible section by
 *    default. A section's `navigation` can override that: `routes` (first
 *    matching answer wins — "if Q = A go to section X / submit") and a
 *    `defaultTarget` (null = next section, 'submit' = finish, or a section id).
 *  - Targets must be LATER sections (enforced when the structure is saved), so
 *    navigation can never loop. A hidden target falls through to the next
 *    visible section after it.
 *  - Sections that are not on the path the answers lead through are treated as
 *    not visible, so their questions are never required or stored.
 */

export type SurveyLogicAction = 'show' | 'hide';
export type SurveyLogicTargetType = 'section' | 'question';

export interface SurveyLogicRuleLike {
  sourceQuestionId: string;
  sourceOptionValue: string;
  action: SurveyLogicAction;
  targetType: SurveyLogicTargetType;
  targetId: string;
  orderIndex: number;
}

/** Only single_choice/multi_choice/dropdown answers can drive a rule. */
export type EnumerationAnswerValue = string | string[] | undefined;

export const SUBMIT_TARGET = 'submit';

export interface SectionNavigationRoute {
  sourceQuestionId: string;
  sourceOptionValue: string;
  /** 'submit' or a (later) section id. */
  target: string;
}

export interface SectionNavigation {
  /** null/undefined = next section, 'submit' = finish, otherwise a (later) section id. */
  defaultTarget?: string | null;
  routes?: SectionNavigationRoute[];
}

export interface VisibilityResult {
  visibleSectionIds: Set<string>;
  visibleQuestionIds: Set<string>;
  /** The visible sections in the order the respondent walks through them. */
  pathSectionIds: string[];
}

export interface NavigableSection {
  id: string;
  questions: Array<{ id: string }>;
  navigation?: SectionNavigation | null;
}

function ruleMatches(rule: { sourceQuestionId: string; sourceOptionValue: string }, answers: Record<string, EnumerationAnswerValue>): boolean {
  const answer = answers[rule.sourceQuestionId];
  if (answer === undefined) return false;
  if (Array.isArray(answer)) return answer.includes(rule.sourceOptionValue);
  return answer === rule.sourceOptionValue;
}

function buildVisibilityTester(rules: SurveyLogicRuleLike[], answers: Record<string, EnumerationAnswerValue>) {
  const rulesByTarget = new Map<string, SurveyLogicRuleLike[]>();
  for (const rule of rules) {
    const key = `${rule.targetType}:${rule.targetId}`;
    const bucket = rulesByTarget.get(key);
    if (bucket) bucket.push(rule);
    else rulesByTarget.set(key, [rule]);
  }

  return function isTargetVisible(targetType: SurveyLogicTargetType, targetId: string): boolean {
    const targetRules = rulesByTarget.get(`${targetType}:${targetId}`);
    if (!targetRules || targetRules.length === 0) return true; // no rules -> always visible

    const ordered = [...targetRules].sort((a, b) => a.orderIndex - b.orderIndex);
    let visible = false;
    for (const rule of ordered) {
      if (!ruleMatches(rule, answers)) continue;
      visible = rule.action === 'show';
      if (rule.action === 'hide') break; // a matching hide always wins, evaluated last-applied
    }
    return visible;
  };
}

/** Index of the section after `fromIndex`, or null when the respondent has reached the end / chose to submit. */
function nextSectionIndex(
  sections: NavigableSection[],
  fromIndex: number,
  answers: Record<string, EnumerationAnswerValue>,
  sectionVisible: (sectionId: string) => boolean,
): number | null {
  const navigation = sections[fromIndex].navigation;
  let target: string | null | undefined = navigation?.defaultTarget;
  for (const route of navigation?.routes ?? []) {
    if (ruleMatches(route, answers)) {
      target = route.target;
      break;
    }
  }
  if (target === SUBMIT_TARGET) return null;

  let wanted = fromIndex + 1;
  if (target) {
    const targetIndex = sections.findIndex((s) => s.id === target);
    if (targetIndex > fromIndex) wanted = targetIndex; // only forward jumps are honoured
  }
  for (let j = wanted; j < sections.length; j++) {
    if (sectionVisible(sections[j].id)) return j;
  }
  return null;
}

/**
 * Resolves the sections the respondent walks through (in order) and the
 * questions visible within them, given the survey's full structure and the
 * respondent's answers so far (only enumeration-type answers matter — other
 * answer types can be omitted from `answers`).
 */
export function resolveVisibility(
  sections: NavigableSection[],
  rules: SurveyLogicRuleLike[],
  answers: Record<string, EnumerationAnswerValue>,
): VisibilityResult {
  const isTargetVisible = buildVisibilityTester(rules, answers);
  const sectionVisible = (id: string) => isTargetVisible('section', id);

  const pathSectionIds: string[] = [];
  const visibleSectionIds = new Set<string>();
  const visibleQuestionIds = new Set<string>();

  let index: number | null = sections.findIndex((s) => sectionVisible(s.id));
  if (index === -1) index = null;
  while (index !== null) {
    const section = sections[index];
    pathSectionIds.push(section.id);
    visibleSectionIds.add(section.id);
    for (const question of section.questions) {
      if (isTargetVisible('question', question.id)) visibleQuestionIds.add(question.id);
    }
    index = nextSectionIndex(sections, index, answers, sectionVisible);
  }

  return { visibleSectionIds, visibleQuestionIds, pathSectionIds };
}

/** The section that follows `currentSectionId` for these answers, or null when the survey is finished (submit). */
export function resolveNextSectionId(
  sections: NavigableSection[],
  rules: SurveyLogicRuleLike[],
  answers: Record<string, EnumerationAnswerValue>,
  currentSectionId: string,
): string | null {
  const fromIndex = sections.findIndex((s) => s.id === currentSectionId);
  if (fromIndex === -1) return null;
  const isTargetVisible = buildVisibilityTester(rules, answers);
  const next = nextSectionIndex(sections, fromIndex, answers, (id) => isTargetVisible('section', id));
  return next === null ? null : sections[next].id;
}
