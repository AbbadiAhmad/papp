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

export interface VisibilityResult {
  visibleSectionIds: Set<string>;
  visibleQuestionIds: Set<string>;
}

function ruleMatches(rule: SurveyLogicRuleLike, answers: Record<string, EnumerationAnswerValue>): boolean {
  const answer = answers[rule.sourceQuestionId];
  if (answer === undefined) return false;
  if (Array.isArray(answer)) return answer.includes(rule.sourceOptionValue);
  return answer === rule.sourceOptionValue;
}

/**
 * Resolves which sections and questions are currently visible, given the
 * survey's full structure and the respondent's answers so far (only
 * enumeration-type answers matter for evaluation — other answer types are
 * irrelevant to any rule and can be omitted from `answers`).
 */
export function resolveVisibility(
  sections: Array<{ id: string; questions: Array<{ id: string }> }>,
  rules: SurveyLogicRuleLike[],
  answers: Record<string, EnumerationAnswerValue>,
): VisibilityResult {
  const rulesByTarget = new Map<string, SurveyLogicRuleLike[]>();
  for (const rule of rules) {
    const key = `${rule.targetType}:${rule.targetId}`;
    const bucket = rulesByTarget.get(key);
    if (bucket) bucket.push(rule);
    else rulesByTarget.set(key, [rule]);
  }

  function isTargetVisible(targetType: SurveyLogicTargetType, targetId: string): boolean {
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
  }

  const visibleSectionIds = new Set<string>();
  const visibleQuestionIds = new Set<string>();

  for (const section of sections) {
    const sectionVisible = isTargetVisible('section', section.id);
    if (!sectionVisible) continue; // a hidden section hides every question inside it
    visibleSectionIds.add(section.id);
    for (const question of section.questions) {
      if (isTargetVisible('question', question.id)) {
        visibleQuestionIds.add(question.id);
      }
    }
  }

  return { visibleSectionIds, visibleQuestionIds };
}
