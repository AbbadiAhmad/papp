import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { SurveyMediaService } from '../../backend/media.service';
import { SurveysService } from '../../backend/surveys.service';
import type { SurveyStructureDto } from '../../backend/dto/survey-structure.dto';

/**
 * Same reflection idiom as books.service.spec.ts: `SurveysService` owns its
 * own `PrismaClient` field (D57), constructed inertly (never `$connect`ed)
 * and never touched by `validateStructure` — a pure, synchronous validation
 * pass that runs entirely off the payload, no DB access at all.
 */
function buildService(): SurveysService {
  return new SurveysService(new SurveyMediaService());
}

function callValidateStructure(service: SurveysService, dto: SurveyStructureDto): void {
  (service as unknown as { validateStructure: (d: SurveyStructureDto) => void }).validateStructure(dto);
}

function baseStructure(): SurveyStructureDto {
  return {
    sections: [
      {
        id: 'sec-1',
        orderIndex: 0,
        title: 'Section 1',
        questions: [
          {
            id: 'q-color',
            orderIndex: 0,
            type: 'single_choice',
            title: 'Pick a color',
            options: [
              { id: 'opt-red', orderIndex: 0, value: 'red', label: 'Red' },
              { id: 'opt-blue', orderIndex: 1, value: 'blue', label: 'Blue' },
            ],
          },
          { id: 'q-followup', orderIndex: 1, type: 'short_text', title: 'Why?' },
        ],
      },
    ],
    logicRules: [
      { sourceQuestionId: 'q-color', sourceOptionValue: 'red', action: 'show', targetType: 'question', targetId: 'q-followup', orderIndex: 0 },
    ],
  } as unknown as SurveyStructureDto;
}

describe('SurveysService.validateStructure: question settings (phase A)', () => {
  function withQuestion(question: Record<string, unknown>): SurveyStructureDto {
    const dto = baseStructure();
    dto.sections[0].questions.push({ id: 'q-extra', orderIndex: 2, title: 'Extra', ...question } as never);
    return dto;
  }
  const options = [
    { id: 'o1', orderIndex: 0, value: 'a', label: 'A' },
    { id: 'o2', orderIndex: 1, value: 'b', label: 'B' },
    { id: 'o3', orderIndex: 2, value: 'c', label: 'C' },
  ];

  it('accepts valid selection limits, "Other", and text validation', () => {
    const service = buildService();
    expect(() => callValidateStructure(service, withQuestion({ type: 'multi_choice', options, config: { minSelections: 1, maxSelections: 2, allowOther: true } }))).not.toThrow();
    expect(() => callValidateStructure(service, withQuestion({ type: 'short_text', config: { validation: { kind: 'number', min: 0, max: 10 }, placeholder: '0-10' } }))).not.toThrow();
  });

  it('rejects a selection limit above the number of options, with the question title in the message', () => {
    const service = buildService();
    expect(() => callValidateStructure(service, withQuestion({ type: 'multi_choice', options, config: { maxSelections: 9 } }))).toThrow(/Extra.*selection limit/);
  });

  it('rejects settings that do not belong to the question type', () => {
    const service = buildService();
    expect(() => callValidateStructure(service, withQuestion({ type: 'single_choice', options, config: { minSelections: 1 } }))).toThrow(BadRequestException);
    expect(() => callValidateStructure(service, withQuestion({ type: 'date', config: { validation: { kind: 'text' } } }))).toThrow(/not available/);
  });

  it('rejects the reserved "Other" option value and duplicate option values', () => {
    const service = buildService();
    expect(() => callValidateStructure(service, withQuestion({ type: 'single_choice', options: [...options, { id: 'o4', orderIndex: 3, value: '__other__', label: 'x' }] }))).toThrow(/reserved/);
    expect(() => callValidateStructure(service, withQuestion({ type: 'single_choice', options: [...options, { id: 'o5', orderIndex: 3, value: 'a', label: 'again' }] }))).toThrow(/same value/);
  });

  it('rejects an invalid scale', () => {
    const service = buildService();
    expect(() => callValidateStructure(service, withQuestion({ type: 'linear_scale', config: { min: 5, max: 2 } }))).toThrow(BadRequestException);
    expect(() => callValidateStructure(service, withQuestion({ type: 'linear_scale', config: { min: 0, max: 10 } }))).not.toThrow();
  });
});

describe('SurveysService.validateStructure', () => {
  it('accepts a well-formed structure with a valid logic rule', () => {
    const service = buildService();
    expect(() => callValidateStructure(service, baseStructure())).not.toThrow();
  });

  it('rejects an enumeration-type question with zero options', () => {
    const service = buildService();
    const dto = baseStructure();
    dto.sections[0].questions[0].options = [];
    expect(() => callValidateStructure(service, dto)).toThrow(BadRequestException);
  });

  it("rejects a logic rule whose sourceQuestionId doesn't exist in this payload", () => {
    const service = buildService();
    const dto = baseStructure();
    dto.logicRules![0].sourceQuestionId = 'does-not-exist';
    expect(() => callValidateStructure(service, dto)).toThrow(BadRequestException);
  });

  it('rejects a logic rule whose source question is not an enumeration type', () => {
    const service = buildService();
    const dto = baseStructure();
    dto.logicRules![0].sourceQuestionId = 'q-followup'; // short_text, not enumeration
    expect(() => callValidateStructure(service, dto)).toThrow(BadRequestException);
  });

  it("rejects a logic rule whose sourceOptionValue isn't a real option on that question", () => {
    const service = buildService();
    const dto = baseStructure();
    dto.logicRules![0].sourceOptionValue = 'green';
    expect(() => callValidateStructure(service, dto)).toThrow(BadRequestException);
  });

  it("rejects a logic rule whose targetId doesn't exist in this payload", () => {
    const service = buildService();
    const dto = baseStructure();
    dto.logicRules![0].targetId = 'does-not-exist';
    expect(() => callValidateStructure(service, dto)).toThrow(BadRequestException);
  });

  it('rejects a logic rule that targets its own source question', () => {
    const service = buildService();
    const dto = baseStructure();
    dto.logicRules![0].targetType = 'question';
    dto.logicRules![0].targetId = 'q-color';
    expect(() => callValidateStructure(service, dto)).toThrow(BadRequestException);
  });

  it('accepts a rule targeting a different section than the source question lives in', () => {
    const service = buildService();
    const dto = baseStructure();
    dto.sections.push({ id: 'sec-2', orderIndex: 1, title: 'Section 2', questions: [] } as never);
    dto.logicRules![0].targetType = 'section';
    dto.logicRules![0].targetId = 'sec-2';
    expect(() => callValidateStructure(service, dto)).not.toThrow();
  });

  it('rejects a rule where a question shows/hides its own section', () => {
    const service = buildService();
    const dto = baseStructure();
    dto.logicRules![0].targetType = 'section';
    dto.logicRules![0].targetId = 'sec-1'; // q-color lives in sec-1
    expect(() => callValidateStructure(service, dto)).toThrow(BadRequestException);
  });

  describe('section navigation', () => {
    function twoSections(): SurveyStructureDto {
      const dto = baseStructure();
      dto.logicRules = [];
      dto.sections.push({ id: 'sec-2', orderIndex: 1, title: 'Section 2', questions: [] } as never);
      return dto;
    }

    it('accepts a go-to route to a later section and a default of submit', () => {
      const dto = twoSections();
      (dto.sections[0] as { navigation?: unknown }).navigation = {
        defaultTarget: 'submit',
        routes: [{ sourceQuestionId: 'q-color', sourceOptionValue: 'red', target: 'sec-2' }],
      };
      expect(() => callValidateStructure(buildService(), dto)).not.toThrow();
    });

    it('rejects a backwards or unknown target', () => {
      const back = twoSections();
      (back.sections[1] as { navigation?: unknown }).navigation = { defaultTarget: 'sec-1' };
      expect(() => callValidateStructure(buildService(), back)).toThrow(BadRequestException);
      const unknown = twoSections();
      (unknown.sections[0] as { navigation?: unknown }).navigation = { defaultTarget: 'nope' };
      expect(() => callValidateStructure(buildService(), unknown)).toThrow(BadRequestException);
    });

    it("rejects a route whose source question is not from the section being left", () => {
      const dto = twoSections();
      (dto.sections[1] as { navigation?: unknown }).navigation = {
        routes: [{ sourceQuestionId: 'q-color', sourceOptionValue: 'red', target: 'submit' }],
      };
      expect(() => callValidateStructure(buildService(), dto)).toThrow(BadRequestException);
    });
  });
});
