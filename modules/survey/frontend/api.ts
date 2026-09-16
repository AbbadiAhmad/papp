// See modules/library_catalog/frontend/api.ts's own docblock: this is a
// same-repo Vite import (bundled with the rest of apps/web), not the
// fragile cross-process import the backend half of this module needs.
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export type SurveyStatus = 'draft' | 'published' | 'closed';

export const SURVEY_QUESTION_TYPES = [
  'short_text',
  'paragraph',
  'single_choice',
  'multi_choice',
  'dropdown',
  'linear_scale',
  'date',
  'time',
  'rating',
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const ENUMERATION_QUESTION_TYPES: readonly SurveyQuestionType[] = ['single_choice', 'multi_choice', 'dropdown'];

export interface SurveySummary {
  id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  requiresLogin: boolean;
  responseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyQuestionOptionDto {
  id: string;
  orderIndex: number;
  value: string;
  label: string;
}

export interface SurveyQuestionDto {
  id: string;
  orderIndex: number;
  type: SurveyQuestionType;
  title: string;
  description?: string | null;
  required?: boolean;
  config?: Record<string, unknown>;
  options?: SurveyQuestionOptionDto[];
}

export interface SurveySectionDto {
  id: string;
  orderIndex: number;
  title: string;
  description?: string | null;
  questions: SurveyQuestionDto[];
}

export interface SurveyLogicRuleDto {
  sourceQuestionId: string;
  sourceOptionValue: string;
  action: 'show' | 'hide';
  targetType: 'section' | 'question';
  targetId: string;
  orderIndex: number;
}

export interface SurveyDetail extends SurveySummary {
  ownerUserId: string;
  allowEditAfterSubmit: boolean;
  oneResponsePerRespondent: boolean;
  notifyOwnerOnSubmit: boolean;
  notifyEmails: string[];
  opensAt: string | null;
  closesAt: string | null;
  sections: SurveySectionDto[];
  logicRules: SurveyLogicRuleDto[];
}

export interface CreateSurveyInput {
  title: string;
  description?: string;
}

export interface UpdateSurveyInput {
  title?: string;
  description?: string;
  requiresLogin?: boolean;
  allowEditAfterSubmit?: boolean;
  oneResponsePerRespondent?: boolean;
  notifyOwnerOnSubmit?: boolean;
  notifyEmails?: string[];
  opensAt?: string | null;
  closesAt?: string | null;
}

export interface SurveyStructureInput {
  sections: SurveySectionDto[];
  logicRules?: SurveyLogicRuleDto[];
}

// --- respondent-facing shapes (see modules/survey/backend/responses.service.ts's toPublicSurvey) ---

export interface FillableQuestion {
  id: string;
  type: SurveyQuestionType;
  title: string;
  description: string | null;
  required: boolean;
  config: Record<string, unknown>;
  options: Array<{ value: string; label: string }>;
}

export interface FillableSurvey {
  id: string;
  title: string;
  description: string | null;
  allowEditAfterSubmit: boolean;
  requiresLogin: boolean;
  sections: Array<{ id: string; questions: FillableQuestion[] }>;
  logicRules: SurveyLogicRuleDto[];
}

export interface ExistingResponse {
  id: string;
  answers: Array<{ questionId: string; value: unknown }>;
}

export interface AnswerInput {
  questionId: string;
  value: unknown;
}

// --- admin response/report shapes ---

export interface ResponseListItem {
  id: string;
  respondentUserId: string | null;
  respondentEmail: string | null;
  submittedAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ResponseDetail extends ResponseListItem {
  surveyId: string;
  answers: Array<{ id: string; questionId: string; value: unknown }>;
}

export interface QuestionSummary {
  questionId: string;
  title: string;
  type: SurveyQuestionType;
  totalAnswered: number;
  optionCounts?: Array<{ value: string; label: string; count: number }>;
  numeric?: { average: number; min: number; max: number; distribution: Array<{ value: number; count: number }> };
  sampleAnswers?: string[];
}

export interface SurveyReportSummary {
  surveyId: string;
  totalResponses: number;
  questions: QuestionSummary[];
}

export interface SurveyDataset {
  columns: Array<{ questionId: string; title: string; type: SurveyQuestionType }>;
  rows: Array<{ responseId: string; submittedAt: string; respondentLabel: string; answers: Record<string, unknown> }>;
}

export const surveyApi = {
  // --- admin: survey definition ---
  list: () => apiClient.get<SurveySummary[]>('/api/survey/surveys').then((r) => r.data),
  get: (id: string) => apiClient.get<SurveyDetail>(`/api/survey/surveys/${id}`).then((r) => r.data),
  create: (dto: CreateSurveyInput) => apiClient.post<SurveyDetail>('/api/survey/surveys', dto).then((r) => r.data),
  update: (id: string, dto: UpdateSurveyInput) => apiClient.patch<SurveyDetail>(`/api/survey/surveys/${id}`, dto).then((r) => r.data),
  remove: (id: string) => apiClient.delete<void>(`/api/survey/surveys/${id}`).then((r) => r.data),
  publish: (id: string) => apiClient.post<SurveyDetail>(`/api/survey/surveys/${id}/publish`).then((r) => r.data),
  close: (id: string) => apiClient.post<SurveyDetail>(`/api/survey/surveys/${id}/close`).then((r) => r.data),
  replaceStructure: (id: string, dto: SurveyStructureInput) =>
    apiClient.put<SurveyDetail>(`/api/survey/surveys/${id}/structure`, dto).then((r) => r.data),

  // --- admin: responses/reports ---
  listResponses: (surveyId: string) => apiClient.get<ResponseListItem[]>(`/api/survey/surveys/${surveyId}/responses`).then((r) => r.data),
  getResponse: (surveyId: string, responseId: string) =>
    apiClient.get<ResponseDetail>(`/api/survey/surveys/${surveyId}/responses/${responseId}`).then((r) => r.data),
  removeResponse: (surveyId: string, responseId: string) =>
    apiClient.delete<void>(`/api/survey/surveys/${surveyId}/responses/${responseId}`).then((r) => r.data),
  exportResponses: (surveyId: string) =>
    apiClient.get<Blob>(`/api/survey/surveys/${surveyId}/responses/export`, { responseType: 'blob' }).then((r) => r.data),
  getSummary: (surveyId: string) => apiClient.get<SurveyReportSummary>(`/api/survey/surveys/${surveyId}/report/summary`).then((r) => r.data),
  getDataset: (surveyId: string) => apiClient.get<SurveyDataset>(`/api/survey/surveys/${surveyId}/report/dataset`).then((r) => r.data),

  // --- respondent: authenticated (any logged-in user, regardless of requiresLogin) ---
  getForFilling: (surveyId: string) =>
    apiClient.get<{ survey: FillableSurvey; existingResponse: ExistingResponse | null }>(`/api/survey/${surveyId}/fill`).then((r) => r.data),
  submitAuthenticated: (surveyId: string, answers: AnswerInput[]) =>
    apiClient.post<{ id: string }>(`/api/survey/${surveyId}/fill`, { answers }).then((r) => r.data),

  // --- respondent: public/anonymous ---
  getForFillingPublic: (surveyId: string) =>
    apiClient.get<{ survey: FillableSurvey; existingResponse: ExistingResponse | null }>(`/api/survey/public/${surveyId}`).then((r) => r.data),
  submitPublic: (surveyId: string, answers: AnswerInput[]) =>
    apiClient.post<{ responseId: string; editToken: string | null }>(`/api/survey/public/${surveyId}`, { answers }).then((r) => r.data),
  editPublic: (surveyId: string, editToken: string, answers: AnswerInput[]) =>
    apiClient.patch<{ id: string }>(`/api/survey/public/${surveyId}`, { answers }, { params: { editToken } }).then((r) => r.data),
};

/** Mirrors library_catalog/frontend/api.ts's own download helper. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
