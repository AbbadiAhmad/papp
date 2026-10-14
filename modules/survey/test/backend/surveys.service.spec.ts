import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { SurveysService } from '../../backend/surveys.service';
import type { SurveyStructureDto } from '../../backend/dto/survey-structure.dto';

/**
 * Same reflection idiom as books.service.spec.ts: `SurveysService` owns its
 * own `PrismaClient` field (D57), constructed inertly (never `$connect`ed)
 * and never touched by `validateStructure` — a pure, synchronous validation
 * pass that runs entirely off the payload, no DB access at all.
 */
function buildService(): SurveysService {
  return new SurveysService();
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
