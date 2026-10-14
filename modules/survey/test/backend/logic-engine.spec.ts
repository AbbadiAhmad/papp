import { describe, expect, it } from '@jest/globals';
import { resolveNextSectionId, resolveVisibility, type SurveyLogicRuleLike } from '../../backend/logic-engine';

const SECTIONS = [
  { id: 'sec-1', questions: [{ id: 'q-color' }, { id: 'q-why-red' }] },
  { id: 'sec-2', questions: [{ id: 'q-followup' }] },
];

function rule(overrides: Partial<SurveyLogicRuleLike>): SurveyLogicRuleLike {
  return {
    sourceQuestionId: 'q-color',
    sourceOptionValue: 'red',
    action: 'show',
    targetType: 'question',
    targetId: 'q-why-red',
    orderIndex: 0,
    ...overrides,
  };
}

describe('resolveVisibility (survey conditional logic engine)', () => {
  it('shows every section/question when there are zero rules at all', () => {
    const result = resolveVisibility(SECTIONS, [], {});
    expect(result.visibleSectionIds).toEqual(new Set(['sec-1', 'sec-2']));
    expect(result.visibleQuestionIds).toEqual(new Set(['q-color', 'q-why-red', 'q-followup']));
  });

  it('hides a target with a rule by default, when the source is unanswered', () => {
    const result = resolveVisibility(SECTIONS, [rule({})], {});
    expect(result.visibleQuestionIds.has('q-why-red')).toBe(false);
    // untouched questions with no rule of their own stay visible
    expect(result.visibleQuestionIds.has('q-color')).toBe(true);
    expect(result.visibleQuestionIds.has('q-followup')).toBe(true);
  });

  it('shows a target once its matching show rule evaluates true', () => {
    const result = resolveVisibility(SECTIONS, [rule({})], { 'q-color': 'red' });
    expect(result.visibleQuestionIds.has('q-why-red')).toBe(true);
  });

  it('keeps a target hidden when the source answer does not match the rule value', () => {
    const result = resolveVisibility(SECTIONS, [rule({})], { 'q-color': 'blue' });
    expect(result.visibleQuestionIds.has('q-why-red')).toBe(false);
  });

  it('matches a multi_choice answer by array inclusion, not exact equality', () => {
    const result = resolveVisibility(SECTIONS, [rule({ sourceOptionValue: 'red' })], { 'q-color': ['blue', 'red'] });
    expect(result.visibleQuestionIds.has('q-why-red')).toBe(true);

    const noMatch = resolveVisibility(SECTIONS, [rule({ sourceOptionValue: 'red' })], { 'q-color': ['blue', 'green'] });
    expect(noMatch.visibleQuestionIds.has('q-why-red')).toBe(false);
  });

  it('a matching hide rule always wins over a matching show rule for the same target', () => {
    const rules: SurveyLogicRuleLike[] = [
      rule({ action: 'show', sourceOptionValue: 'red', orderIndex: 0 }),
      rule({ action: 'hide', sourceOptionValue: 'red', orderIndex: 1 }),
    ];
    const result = resolveVisibility(SECTIONS, rules, { 'q-color': 'red' });
    expect(result.visibleQuestionIds.has('q-why-red')).toBe(false);
  });

  it('a matching hide evaluated FIRST (by orderIndex) short-circuits — a later show for the same target never gets evaluated at all', () => {
    const rules: SurveyLogicRuleLike[] = [
      rule({ action: 'hide', sourceOptionValue: 'red', orderIndex: 0 }),
      rule({ action: 'show', sourceOptionValue: 'red', orderIndex: 1 }),
    ];
    // Rules are evaluated in orderIndex order; a matching `hide` breaks the
    // loop immediately (logic-engine.ts's own comment: "evaluated last-
    // applied"), so the show rule at orderIndex 1 is never reached — the
    // target stays hidden regardless of what a later rule would have said.
    const result = resolveVisibility(SECTIONS, rules, { 'q-color': 'red' });
    expect(result.visibleQuestionIds.has('q-why-red')).toBe(false);
  });

  it('hiding a section hides every question inside it, even one with its own matching show rule', () => {
    const rules: SurveyLogicRuleLike[] = [
      rule({ targetType: 'section', targetId: 'sec-1', action: 'hide', sourceOptionValue: 'blue' }),
      rule({ targetType: 'question', targetId: 'q-why-red', action: 'show', sourceOptionValue: 'red' }),
    ];
    const result = resolveVisibility(SECTIONS, rules, { 'q-color': 'blue' });
    expect(result.visibleSectionIds.has('sec-1')).toBe(false);
    expect(result.visibleQuestionIds.has('q-color')).toBe(false);
    expect(result.visibleQuestionIds.has('q-why-red')).toBe(false);
  });

  it('a section with its own rule follows the same hidden-by-default semantics as a question', () => {
    const rules: SurveyLogicRuleLike[] = [rule({ targetType: 'section', targetId: 'sec-2', action: 'show', sourceOptionValue: 'red' })];
    const hiddenByDefault = resolveVisibility(SECTIONS, rules, {});
    expect(hiddenByDefault.visibleSectionIds.has('sec-2')).toBe(false);
    expect(hiddenByDefault.visibleQuestionIds.has('q-followup')).toBe(false);

    const shownOnMatch = resolveVisibility(SECTIONS, rules, { 'q-color': 'red' });
    expect(shownOnMatch.visibleSectionIds.has('sec-2')).toBe(true);
    expect(shownOnMatch.visibleQuestionIds.has('q-followup')).toBe(true);
  });
});

describe('section navigation (paged surveys)', () => {
  const sections = (nav2?: object) => [
    { id: 'a', questions: [{ id: 'qa' }], navigation: { routes: [{ sourceQuestionId: 'qa', sourceOptionValue: 'skip', target: 'c' }] } },
    { id: 'b', questions: [{ id: 'qb' }], navigation: nav2 },
    { id: 'c', questions: [{ id: 'qc' }] },
  ];

  it('goes to the next section by default', () => {
    expect(resolveNextSectionId(sections(), [], { qa: 'other' }, 'a')).toBe('b');
    expect(resolveVisibility(sections(), [], { qa: 'other' }).pathSectionIds).toEqual(['a', 'b', 'c']);
  });

  it('jumps over sections when an answer matches a go-to route, and skipped questions are not visible', () => {
    expect(resolveNextSectionId(sections(), [], { qa: 'skip' }, 'a')).toBe('c');
    const result = resolveVisibility(sections(), [], { qa: 'skip' });
    expect(result.pathSectionIds).toEqual(['a', 'c']);
    expect(result.visibleQuestionIds).toEqual(new Set(['qa', 'qc']));
  });

  it("'submit' ends the survey", () => {
    expect(resolveNextSectionId(sections({ defaultTarget: 'submit' }), [], {}, 'b')).toBeNull();
    expect(resolveVisibility(sections({ defaultTarget: 'submit' }), [], { qa: 'x' }).pathSectionIds).toEqual(['a', 'b']);
  });

  it('skips a hidden section on the way', () => {
    const hideB: SurveyLogicRuleLike[] = [
      { sourceQuestionId: 'qa', sourceOptionValue: 'x', action: 'hide', targetType: 'section', targetId: 'b', orderIndex: 0 },
    ];
    expect(resolveNextSectionId(sections(), hideB, { qa: 'x' }, 'a')).toBe('c');
  });

  it('ignores a backwards target (no loops)', () => {
    const back = [{ id: 'a', questions: [], navigation: undefined }, { id: 'b', questions: [], navigation: { defaultTarget: 'a' } }, { id: 'c', questions: [] }];
    expect(resolveNextSectionId(back, [], {}, 'b')).toBe('c');
  });
});
