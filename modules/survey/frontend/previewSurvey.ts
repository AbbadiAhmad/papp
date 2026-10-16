import type { FillableSurvey, SurveyImage, SurveyLogicRuleDto, SurveySectionDto } from './api';

/**
 * Turns the builder's in-memory (possibly unsaved) structure into the exact
 * shape the respondent page loads from the server, so the preview runs the
 * real `SurveyRunner` on it. Pure and side-effect free.
 */
export function toFillableSurvey(
  survey: { id: string; title: string; description?: string | null; allowEditAfterSubmit?: boolean; requiresLogin?: boolean; settings?: { headerImage?: SurveyImage } },
  sections: SurveySectionDto[],
  logicRules: SurveyLogicRuleDto[],
): FillableSurvey {
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description?.trim() ? survey.description : null,
    allowEditAfterSubmit: Boolean(survey.allowEditAfterSubmit),
    requiresLogin: Boolean(survey.requiresLogin),
    headerImage: survey.settings?.headerImage ?? null,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description?.trim() ? section.description : null,
      navigation: section.navigation ?? {},
      image: section.image ?? null,
      questions: section.questions.map((question) => ({
        id: question.id,
        type: question.type,
        title: question.title,
        description: question.description?.trim() ? question.description : null,
        required: Boolean(question.required),
        config: question.config ?? {},
        options: (question.options ?? []).map((option) => ({ value: option.value, label: option.label })),
      })),
    })),
    logicRules,
  };
}
