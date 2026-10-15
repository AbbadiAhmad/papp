import { describe, expect, it } from 'vitest';
import { toFillableSurvey } from '../../frontend/previewSurvey';
import type { SurveySectionDto } from '../../frontend/api';

describe('toFillableSurvey (builder state -> what a reader loads)', () => {
  const sections: SurveySectionDto[] = [
    {
      id: 's1',
      orderIndex: 0,
      title: 'One',
      description: '   ',
      navigation: { defaultTarget: 'submit' },
      questions: [
        {
          id: 'q1',
          orderIndex: 0,
          type: 'single_choice',
          title: 'Pick',
          description: 'A hint',
          required: true,
          config: { allowOther: true },
          options: [{ id: 'o1', orderIndex: 0, value: 'a', label: 'A' }],
        },
        { id: 'q2', orderIndex: 1, type: 'short_text', title: 'Name' },
      ],
    },
  ];

  it('maps options to {value,label}, normalises blanks and defaults, and keeps navigation and rules', () => {
    const rules = [{ sourceQuestionId: 'q1', sourceOptionValue: 'a', action: 'show' as const, targetType: 'question' as const, targetId: 'q2', orderIndex: 0 }];
    const result = toFillableSurvey({ id: 'sv', title: 'Survey', description: '' }, sections, rules);

    expect(result).toMatchObject({ id: 'sv', title: 'Survey', description: null, allowEditAfterSubmit: false, requiresLogin: false, logicRules: rules });
    expect(result.sections[0]).toMatchObject({ id: 's1', description: null, navigation: { defaultTarget: 'submit' } });
    expect(result.sections[0].questions[0]).toEqual({
      id: 'q1',
      type: 'single_choice',
      title: 'Pick',
      description: 'A hint',
      required: true,
      config: { allowOther: true },
      options: [{ value: 'a', label: 'A' }],
    });
    expect(result.sections[0].questions[1]).toMatchObject({ description: null, required: false, config: {}, options: [] });
  });
});
