import { describe, expect, it } from '@jest/globals';
import {
  answerForDisplay,
  describeProblem,
  encodeOther,
  formatAnswerForDisplay,
  isEmptyAnswer,
  summarizeChoiceAnswers,
  validateAnswer,
  validateOptionValues,
  validateQuestionConfig,
} from '../../backend/question-rules';

const COLORS = ['red', 'green', 'blue'];

describe('validateQuestionConfig', () => {
  it('accepts a missing config and an empty one for every type', () => {
    for (const type of ['short_text', 'paragraph', 'single_choice', 'multi_choice', 'dropdown', 'linear_scale', 'date', 'time', 'rating'] as const) {
      expect(validateQuestionConfig(type, undefined, COLORS)).toBeNull();
      expect(validateQuestionConfig(type, {}, COLORS)).toBeNull();
    }
  });

  it('rejects a config that is not an object', () => {
    expect(validateQuestionConfig('short_text', 'x')?.code).toBe('config_not_object');
    expect(validateQuestionConfig('short_text', [])?.code).toBe('config_not_object');
  });

  describe('selection limits (multi_choice)', () => {
    it('accepts min, max, range and exactly-N', () => {
      expect(validateQuestionConfig('multi_choice', { minSelections: 1 }, COLORS)).toBeNull();
      expect(validateQuestionConfig('multi_choice', { maxSelections: 2 }, COLORS)).toBeNull();
      expect(validateQuestionConfig('multi_choice', { minSelections: 2, maxSelections: 3 }, COLORS)).toBeNull();
      expect(validateQuestionConfig('multi_choice', { minSelections: 2, maxSelections: 2 }, COLORS)).toBeNull();
    });

    it('rejects min greater than max, non-integers, negatives, and limits above the number of options', () => {
      expect(validateQuestionConfig('multi_choice', { minSelections: 3, maxSelections: 2 }, COLORS)?.code).toBe('min_gt_max');
      expect(validateQuestionConfig('multi_choice', { minSelections: 1.5 }, COLORS)?.code).toBe('bad_config_number');
      expect(validateQuestionConfig('multi_choice', { maxSelections: -1 }, COLORS)?.code).toBe('bad_config_number');
      expect(validateQuestionConfig('multi_choice', { minSelections: 4 }, COLORS)?.code).toBe('limit_exceeds_options');
      expect(validateQuestionConfig('multi_choice', { maxSelections: 9 }, COLORS)?.code).toBe('limit_exceeds_options');
    });

    it('counts the "Other" choice towards the available options', () => {
      expect(validateQuestionConfig('multi_choice', { minSelections: 4, allowOther: true }, COLORS)).toBeNull();
    });

    it('requires the exclusive option to be one of the options, and only on multi_choice', () => {
      expect(validateQuestionConfig('multi_choice', { exclusiveOptionValue: 'red' }, COLORS)).toBeNull();
      expect(validateQuestionConfig('multi_choice', { exclusiveOptionValue: 'purple' }, COLORS)?.code).toBe('unknown_exclusive');
      expect(validateQuestionConfig('single_choice', { minSelections: 1 }, COLORS)?.code).toBe('config_not_allowed');
    });
  });

  describe('"Other"', () => {
    it('is allowed on the three choice types only', () => {
      for (const type of ['single_choice', 'multi_choice', 'dropdown'] as const) {
        expect(validateQuestionConfig(type, { allowOther: true, otherLabel: 'Something else' }, COLORS)).toBeNull();
      }
      expect(validateQuestionConfig('short_text', { allowOther: true })?.code).toBe('config_not_allowed');
    });

    it('limits the label length', () => {
      expect(validateQuestionConfig('single_choice', { allowOther: true, otherLabel: 'x'.repeat(101) }, COLORS)?.code).toBe('text_too_long_config');
    });
  });

  describe('text validation', () => {
    it('accepts every kind on short_text and only "text" on paragraph', () => {
      for (const kind of ['text', 'number', 'email', 'url']) {
        expect(validateQuestionConfig('short_text', { validation: { kind } })).toBeNull();
      }
      expect(validateQuestionConfig('paragraph', { validation: { kind: 'text', maxLength: 500 } })).toBeNull();
      expect(validateQuestionConfig('paragraph', { validation: { kind: 'email' } })?.code).toBe('bad_validation_kind');
    });

    it('rejects unknown kinds, bad limits, inverted ranges and over-long messages', () => {
      expect(validateQuestionConfig('short_text', { validation: { kind: 'regex' } })?.code).toBe('bad_validation_kind');
      expect(validateQuestionConfig('short_text', { validation: { kind: 'text', maxLength: 0 } })?.code).toBe('bad_config_number');
      expect(validateQuestionConfig('short_text', { validation: { kind: 'text', maxLength: 10_001 } })?.code).toBe('bad_config_number');
      expect(validateQuestionConfig('short_text', { validation: { kind: 'number', min: 5, max: 1 } })?.code).toBe('min_gt_max');
      expect(validateQuestionConfig('short_text', { validation: { kind: 'text', message: 'x'.repeat(251) } })?.code).toBe('text_too_long_config');
    });

    it('is not available on other types', () => {
      expect(validateQuestionConfig('date', { validation: { kind: 'text' } })?.code).toBe('config_not_allowed');
      expect(validateQuestionConfig('single_choice', { placeholder: 'x' }, COLORS)?.code).toBe('config_not_allowed');
    });
  });

  describe('scales', () => {
    it('needs whole numbers with min below max', () => {
      expect(validateQuestionConfig('linear_scale', { min: 0, max: 10 })).toBeNull();
      expect(validateQuestionConfig('rating', { max: 7 })).toBeNull();
      expect(validateQuestionConfig('linear_scale', { min: 5, max: 5 })?.code).toBe('bad_scale_config');
      expect(validateQuestionConfig('linear_scale', { min: 1.5, max: 5 })?.code).toBe('bad_scale_config');
      expect(validateQuestionConfig('rating', { max: 1 })?.code).toBe('bad_scale_config');
    });
  });
});

describe('validateOptionValues', () => {
  it('rejects the reserved "Other" value or prefix and duplicates', () => {
    expect(validateOptionValues(['a', 'b'])).toBeNull();
    expect(validateOptionValues(['a', '__other__'])?.code).toBe('reserved_option_value');
    expect(validateOptionValues(['__other__:x'])?.code).toBe('reserved_option_value');
    expect(validateOptionValues(['a', 'a'])?.code).toBe('duplicate_option_value');
  });
});

describe('validateAnswer: choices', () => {
  it('single_choice / dropdown accept only listed options', () => {
    expect(validateAnswer('single_choice', {}, COLORS, 'red')).toBeNull();
    expect(validateAnswer('dropdown', {}, COLORS, 'purple')?.code).toBe('invalid_option');
    expect(validateAnswer('single_choice', {}, COLORS, 3)?.code).toBe('invalid_option');
  });

  it('"Other" is accepted only when enabled, needs text, and is length-limited', () => {
    expect(validateAnswer('single_choice', { allowOther: true }, COLORS, encodeOther('teal'))).toBeNull();
    expect(validateAnswer('single_choice', {}, COLORS, encodeOther('teal'))?.code).toBe('other_not_allowed');
    expect(validateAnswer('dropdown', { allowOther: true }, COLORS, encodeOther('   '))?.code).toBe('other_empty');
    expect(validateAnswer('dropdown', { allowOther: true }, COLORS, encodeOther('x'.repeat(501)))?.code).toBe('other_too_long');
  });

  describe('multi_choice selection limits', () => {
    const cfg = { minSelections: 2, maxSelections: 3 };
    it('rejects too few and too many, accepts the boundaries', () => {
      expect(validateAnswer('multi_choice', cfg, COLORS, ['red'])).toEqual({ code: 'too_few_selected', params: { min: 2 } });
      expect(validateAnswer('multi_choice', cfg, COLORS, ['red', 'green'])).toBeNull();
      expect(validateAnswer('multi_choice', cfg, COLORS, ['red', 'green', 'blue'])).toBeNull();
      expect(validateAnswer('multi_choice', { maxSelections: 2 }, COLORS, COLORS)).toEqual({ code: 'too_many_selected', params: { max: 2 } });
    });

    it('"exactly N" is min = max', () => {
      const exactly = { minSelections: 2, maxSelections: 2 };
      expect(validateAnswer('multi_choice', exactly, COLORS, ['red'])?.code).toBe('too_few_selected');
      expect(validateAnswer('multi_choice', exactly, COLORS, ['red', 'green'])).toBeNull();
      expect(validateAnswer('multi_choice', exactly, COLORS, COLORS)?.code).toBe('too_many_selected');
    });

    it('counts an "Other" entry as one selection', () => {
      const c = { maxSelections: 2, allowOther: true };
      expect(validateAnswer('multi_choice', c, COLORS, ['red', encodeOther('teal')])).toBeNull();
      expect(validateAnswer('multi_choice', c, COLORS, ['red', 'green', encodeOther('teal')])?.code).toBe('too_many_selected');
    });

    it('an exclusive "None" choice must stand alone and is exempt from the count', () => {
      const c = { minSelections: 2, exclusiveOptionValue: 'blue' };
      expect(validateAnswer('multi_choice', c, COLORS, ['blue'])).toBeNull();
      expect(validateAnswer('multi_choice', c, COLORS, ['blue', 'red'])?.code).toBe('exclusive_conflict');
      expect(validateAnswer('multi_choice', c, COLORS, ['red'])?.code).toBe('too_few_selected');
    });

    it('rejects unknown, duplicate and non-string selections', () => {
      expect(validateAnswer('multi_choice', {}, COLORS, ['red', 'purple'])?.code).toBe('invalid_options');
      expect(validateAnswer('multi_choice', {}, COLORS, ['red', 'red'])?.code).toBe('duplicate_selection');
      expect(validateAnswer('multi_choice', {}, COLORS, 'red')?.code).toBe('invalid_options');
      expect(validateAnswer('multi_choice', {}, COLORS, [1])?.code).toBe('invalid_options');
      expect(validateAnswer('multi_choice', { allowOther: true }, COLORS, [encodeOther('a'), encodeOther('b')])?.code).toBe('duplicate_selection');
    });
  });
});

describe('validateAnswer: text', () => {
  const rule = (validation: Record<string, unknown>) => ({ validation });

  it('enforces a maximum length with the right parameter', () => {
    expect(validateAnswer('short_text', rule({ kind: 'text', maxLength: 5 }), [], 'abcde')).toBeNull();
    expect(validateAnswer('short_text', rule({ kind: 'text', maxLength: 5 }), [], 'abcdef')).toEqual({ code: 'too_long', params: { max: 5 }, message: undefined });
    expect(validateAnswer('paragraph', rule({ kind: 'text', maxLength: 3 }), [], 'abcd')?.code).toBe('too_long');
  });

  it('has a hard ceiling even with no configured limit', () => {
    expect(validateAnswer('paragraph', {}, [], 'x'.repeat(10_000))).toBeNull();
    expect(validateAnswer('paragraph', {}, [], 'x'.repeat(10_001))?.code).toBe('too_long');
  });

  it('number: format, integer-only, and inclusive min/max', () => {
    const number = rule({ kind: 'number', min: 1, max: 120 });
    expect(validateAnswer('short_text', number, [], '35')).toBeNull();
    expect(validateAnswer('short_text', number, [], ' 35 ')).toBeNull();
    expect(validateAnswer('short_text', number, [], '1')).toBeNull();
    expect(validateAnswer('short_text', number, [], '120')).toBeNull();
    expect(validateAnswer('short_text', number, [], '0')?.code).toBe('below_min');
    expect(validateAnswer('short_text', number, [], '121')?.code).toBe('above_max');
    expect(validateAnswer('short_text', number, [], 'abc')?.code).toBe('not_number');
    expect(validateAnswer('short_text', number, [], '٣٥')?.code).toBe('not_number'); // only digits 0-9 (platform rule D6)
    expect(validateAnswer('short_text', rule({ kind: 'number', integer: true }), [], '3.5')?.code).toBe('not_integer');
    expect(validateAnswer('short_text', rule({ kind: 'number' }), [], '3.5')).toBeNull();
    expect(validateAnswer('short_text', rule({ kind: 'number' }), [], '-2')).toBeNull();
  });

  it('email and url', () => {
    expect(validateAnswer('short_text', rule({ kind: 'email' }), [], 'reader@example.com')).toBeNull();
    expect(validateAnswer('short_text', rule({ kind: 'email' }), [], 'reader@')?.code).toBe('bad_email');
    expect(validateAnswer('short_text', rule({ kind: 'url' }), [], 'https://example.com/a?b=1')).toBeNull();
    expect(validateAnswer('short_text', rule({ kind: 'url' }), [], 'javascript:alert(1)')?.code).toBe('bad_url');
    expect(validateAnswer('short_text', rule({ kind: 'url' }), [], 'example.com')?.code).toBe('bad_url');
  });

  it("uses the owner's custom message when one is set, and the code otherwise", () => {
    const custom = validateAnswer('short_text', rule({ kind: 'email', message: 'Please use your library email' }), [], 'nope');
    expect(custom?.message).toBe('Please use your library email');
    expect(describeProblem(custom!)).toBe('Please use your library email');
    const plain = validateAnswer('short_text', rule({ kind: 'email' }), [], 'nope');
    expect(describeProblem(plain!)).toBe('must be a valid email address');
  });

  it('rejects non-string text answers', () => {
    expect(validateAnswer('short_text', {}, [], 5)?.code).toBe('not_text');
  });
});

describe('validateAnswer: scales, dates and times', () => {
  it('scale values must be whole numbers inside the configured range', () => {
    expect(validateAnswer('linear_scale', { min: 0, max: 10 }, [], 0)).toBeNull();
    expect(validateAnswer('linear_scale', { min: 0, max: 10 }, [], 11)?.code).toBe('not_scale_value');
    expect(validateAnswer('linear_scale', {}, [], 3)).toBeNull(); // defaults 1..5
    expect(validateAnswer('rating', { max: 5 }, [], 6)?.code).toBe('not_scale_value');
    expect(validateAnswer('rating', { max: 5 }, [], 2.5)?.code).toBe('not_scale_value');
    expect(validateAnswer('rating', { max: 5 }, [], '3')?.code).toBe('not_number_value');
  });

  it('dates must be real calendar dates in YYYY-MM-DD', () => {
    expect(validateAnswer('date', {}, [], '2026-02-28')).toBeNull();
    expect(validateAnswer('date', {}, [], '2024-02-29')).toBeNull();
    expect(validateAnswer('date', {}, [], '2026-02-30')?.code).toBe('bad_date');
    expect(validateAnswer('date', {}, [], '28/02/2026')?.code).toBe('bad_date');
  });

  it('times are HH:MM or HH:MM:SS', () => {
    expect(validateAnswer('time', {}, [], '09:30')).toBeNull();
    expect(validateAnswer('time', {}, [], '23:59:59')).toBeNull();
    expect(validateAnswer('time', {}, [], '24:00')?.code).toBe('bad_time');
    expect(validateAnswer('time', {}, [], '9:30')?.code).toBe('bad_time');
  });
});

describe('isEmptyAnswer', () => {
  it('treats undefined, null, empty text and an empty selection as empty', () => {
    for (const v of [undefined, null, '', []]) expect(isEmptyAnswer(v)).toBe(true);
    for (const v of ['a', 0, ['a'], false]) expect(isEmptyAnswer(v)).toBe(false);
  });
});

describe('summarizeChoiceAnswers and display helpers', () => {
  const options = [
    { value: 'red', label: 'Red' },
    { value: 'blue', label: 'Blue' },
  ];

  it('counts options and collapses "Other" answers into one extra bar with their texts', () => {
    const result = summarizeChoiceAnswers(options, ['red', ['red', encodeOther('teal')], encodeOther('mauve')], { allowOther: true, otherLabel: 'Something else' });
    expect(result.optionCounts).toEqual([
      { value: 'red', label: 'Red', count: 2 },
      { value: 'blue', label: 'Blue', count: 0 },
      { value: '__other__', label: 'Something else', count: 2 },
    ]);
    expect(result.otherAnswers).toEqual(['teal', 'mauve']);
  });

  it('adds no "Other" bar when it is neither allowed nor used', () => {
    expect(summarizeChoiceAnswers(options, ['red'], {}).optionCounts).toHaveLength(2);
  });

  it('formats answers for exports and notifications', () => {
    expect(formatAnswerForDisplay(['red', encodeOther('teal')])).toBe('red, Other: teal');
    expect(formatAnswerForDisplay(encodeOther('teal'), 'Autre')).toBe('Autre: teal');
    expect(formatAnswerForDisplay(5)).toBe('5');
    expect(answerForDisplay(['a', encodeOther('b')])).toEqual(['a', 'Other: b']);
    expect(answerForDisplay(3)).toBe(3);
  });
});
