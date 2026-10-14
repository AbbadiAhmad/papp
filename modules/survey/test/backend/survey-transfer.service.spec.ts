import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import JSZip from 'jszip';
import { SurveyTransferService, SURVEY_PACKAGE_FORMAT, SURVEY_PACKAGE_VERSION } from '../../backend/survey-transfer.service';
import { SurveysService } from '../../backend/surveys.service';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const Q1 = '33333333-3333-4333-8333-333333333333';
const O1 = '44444444-4444-4444-8444-444444444444';

function pkg(overrides: Record<string, unknown> = {}) {
  return {
    format: SURVEY_PACKAGE_FORMAT,
    version: SURVEY_PACKAGE_VERSION,
    survey: { title: 'T' },
    sections: [
      { id: S1, orderIndex: 0, title: 'A', questions: [{ id: Q1, orderIndex: 0, type: 'single_choice', title: 'Q', options: [{ id: O1, orderIndex: 0, value: 'x', label: 'X' }] }] },
      { id: S2, orderIndex: 1, title: 'B', questions: [] },
    ],
    logicRules: [{ sourceQuestionId: Q1, sourceOptionValue: 'x', action: 'show', targetType: 'section', targetId: S2, orderIndex: 0 }],
    ...overrides,
  };
}

const service = new SurveyTransferService(new SurveysService());
const validate = (value: unknown) => (service as unknown as { validatePackage: (v: unknown) => unknown }).validatePackage(value);

describe('SurveyTransferService package validation', () => {
  it('accepts a well-formed package', () => {
    expect(() => validate(pkg())).not.toThrow();
  });

  it('rejects a file that is not a survey package', () => {
    expect(() => validate({ hello: 'world' })).toThrow(BadRequestException);
  });

  it('rejects a newer package version than this build understands', () => {
    expect(() => validate(pkg({ version: SURVEY_PACKAGE_VERSION + 1 }))).toThrow(BadRequestException);
  });

  it('rejects a rule that targets the section its own source question lives in', () => {
    const bad = pkg({ logicRules: [{ sourceQuestionId: Q1, sourceOptionValue: 'x', action: 'hide', targetType: 'section', targetId: S1, orderIndex: 0 }] });
    expect(() => validate(bad)).toThrow(BadRequestException);
  });

  it('rejects a structure with a non-UUID id', () => {
    const bad = pkg();
    (bad.sections[0] as { id: string }).id = 'not-a-uuid';
    expect(() => validate(bad)).toThrow(BadRequestException);
  });

  it('rejects an archive that is not a zip or lacks survey.json', async () => {
    await expect(service.importZip(Buffer.from('nope'), 'u', false)).rejects.toThrow(BadRequestException);
    const zip = new JSZip();
    zip.file('other.json', '{}');
    await expect(service.importZip(await zip.generateAsync({ type: 'nodebuffer' }), 'u', false)).rejects.toThrow(BadRequestException);
  });
});
